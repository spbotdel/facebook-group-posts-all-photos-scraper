export const DEFAULT_RESULT_EVENT = 'apify-default-dataset-item';

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// Pay-per-event budget for the group posts actor. Without this the actor keeps
// pushing rows after the caller's charge limit is exhausted, which is what made
// the group actor lose money while the profile actor (that has this guard)
// stayed profitable. Ported from facebook-profile-posts-scraper 2026-09-30.
export function createResultChargeBudget(chargingManager) {
    const pricingInfo = chargingManager.getPricingInfo();
    const perResultPriceUsd = Number(pricingInfo.perEventPrices?.[DEFAULT_RESULT_EVENT] || 0);
    const resultEventEnabled = Boolean(pricingInfo.isPayPerEvent && perResultPriceUsd > 0);

    function remainingRows() {
        if (!resultEventEnabled) return Infinity;
        return chargingManager.calculateMaxEventChargeCountWithinLimit(DEFAULT_RESULT_EVENT);
    }

    return {
        pricingModel: pricingInfo.pricingModel || null,
        maxTotalChargeUsd: finiteOrNull(pricingInfo.maxTotalChargeUsd),
        perResultPriceUsd: resultEventEnabled ? perResultPriceUsd : null,
        resultEventEnabled,
        remainingRows,
        capRequestedRows(requestedRows) {
            const requested = Math.max(0, Math.floor(Number(requestedRows) || 0));
            const remaining = remainingRows();
            return Number.isFinite(remaining) ? Math.min(requested, remaining) : requested;
        },
        pushedRows(requestedRows, chargeResult) {
            const requested = Math.max(0, Math.floor(Number(requestedRows) || 0));
            if (!resultEventEnabled) return requested;
            const charged = Math.max(0, Math.floor(Number(chargeResult?.chargedCount) || 0));
            return Math.min(requested, charged);
        },
        limitReached(chargeResult) {
            return resultEventEnabled
                && (Boolean(chargeResult?.eventChargeLimitReached) || remainingRows() <= 0);
        },
    };
}
