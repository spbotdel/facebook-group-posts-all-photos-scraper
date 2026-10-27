import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResultChargeBudget, DEFAULT_RESULT_EVENT } from '../src/charging.js';

// Minimal stand-in for Apify's ChargingManager. Owner runs report no pricing
// (verified in production 2026-09-30), while paying runs report the real event
// price and the caller's maxTotalChargeUsd.
function mockChargingManager({ price, maxChargeUsd, usedUsd = 0, limitReached = false }) {
    return {
        getPricingInfo: () => ({
            pricingModel: 'PAY_PER_EVENT',
            isPayPerEvent: true,
            perEventPrices: price == null ? {} : { [DEFAULT_RESULT_EVENT]: price },
            maxTotalChargeUsd: maxChargeUsd ?? null,
        }),
        calculateMaxEventChargeCountWithinLimit: () => {
            if (price == null || maxChargeUsd == null) return Infinity;
            const remainingUsd = Math.max(0, maxChargeUsd - usedUsd);
            return Math.floor(remainingUsd / price);
        },
        // Simulates Apify refusing to charge more than the remaining budget.
        chargeResultFor: (requested) => ({ chargedCount: requested, eventChargeLimitReached: limitReached }),
    };
}

test('owner runs without pricing never cap the walk', () => {
    const budget = createResultChargeBudget(mockChargingManager({ price: null }));
    assert.equal(budget.resultEventEnabled, false);
    assert.equal(budget.remainingRows(), Infinity);
    assert.equal(budget.capRequestedRows(100), 100);
    assert.equal(budget.limitReached({ eventChargeLimitReached: false }), false);
});

test('paying run with $0.02 budget and $0.00249 price caps at 8 rows', () => {
    const budget = createResultChargeBudget(mockChargingManager({ price: 0.00249, maxChargeUsd: 0.02 }));
    assert.equal(budget.resultEventEnabled, true);
    assert.equal(budget.remainingRows(), 8);
    assert.equal(budget.capRequestedRows(100), 8);
    assert.equal(budget.capRequestedRows(3), 3);
});

test('budget shrinks as spend grows and reports exhaustion', () => {
    const manager = mockChargingManager({ price: 0.00249, maxChargeUsd: 0.01, usedUsd: 0.0075 });
    const budget = createResultChargeBudget(manager);
    assert.equal(budget.remainingRows(), 1);
    assert.equal(budget.capRequestedRows(100), 1);
    const exhausted = createResultChargeBudget(mockChargingManager({ price: 0.00249, maxChargeUsd: 0.01, usedUsd: 0.01 }));
    assert.equal(exhausted.remainingRows(), 0);
    assert.equal(exhausted.limitReached({ eventChargeLimitReached: false }), true);
});

test('partial charge stops the batch and counts only billed rows', () => {
    const budget = createResultChargeBudget(mockChargingManager({ price: 0.00249, maxChargeUsd: 0.02 }));
    // Apify charged only 5 of 20 requested because the rest exceeded the cap.
    const written = budget.pushedRows(20, { chargedCount: 5, eventChargeLimitReached: true });
    assert.equal(written, 5);
    assert.equal(budget.limitReached({ chargedCount: 5, eventChargeLimitReached: true }), true);
});
