import { SellerStats } from "./scrapers/SellerScraper";
import { TimeInfo } from "./util/dates";
import { clamp } from "./util/math";

export enum SellerFlag {
    LowActiveItems,
    LowSoldItems,
    HighCheapItems,
    LowImages,
    ShortDescriptions,
    LowReturns,
    LowReturnPayment,
    LowFreePostage,
    LowFeedbackCount,
    PoorFeedback,
    HighDuplicateFeedback,
    NewAccount,
}

type HasKeys<KeyOf, ValueType> = {
    [K in keyof KeyOf]: ValueType;
};

interface FactorMeta {
    weight: number;
    max: number;
}

interface FactorValues extends HasKeys<SellerStats, FactorMeta> {
    timeSinceCreation: FactorMeta;
}

const factorValues: FactorValues = {
    activeItems: {
        weight: 1,
        max: 60,
    },
    soldItems: {
        weight: 8,
        max: 1000,
    },
    cheapItemsPercentage: {
        weight: -3, // Use minus numbers for negative factors (factors that worsen the score, the higher they are)
        max: 100,
    },
    averageImageCount: {
        weight: 2,
        max: 7, // Maximum is actually 24, but anything above 10 is fine - same principle applies for other factors
    },
    averageDescriptionLength: {
        weight: 1,
        max: 100,
    },
    acceptReturnsPercentage: {
        weight: 10,
        max: 100,
    },
    sellerPaysReturnsPercentage: {
        weight: 3,
        max: 100,
    },
    freePostagePercentage: {
        weight: 3,
        max: 100,
    },
    feedbackCount: {
        weight: 20,
        max: 100,
    },
    positiveFeedbackPercentage: {
        weight: 10,
        max: 100,
    },
    duplicateFeedbackPercentage: {
        weight: -10,
        max: 100,
    },
    timeSinceCreation: {
        weight: 7,
        max: 365 * 2, // 2 years
    },
};

type FactorFlags = HasKeys<SellerStats, SellerFlag>;
const factorFlags: FactorFlags = {
    activeItems: SellerFlag.LowActiveItems,
    soldItems: SellerFlag.LowSoldItems,
    cheapItemsPercentage: SellerFlag.HighCheapItems,
    averageImageCount: SellerFlag.LowImages,
    averageDescriptionLength: SellerFlag.ShortDescriptions,
    acceptReturnsPercentage: SellerFlag.LowReturns,
    sellerPaysReturnsPercentage: SellerFlag.LowReturnPayment,
    freePostagePercentage: SellerFlag.LowFreePostage,
    feedbackCount: SellerFlag.LowFeedbackCount,
    positiveFeedbackPercentage: SellerFlag.PoorFeedback,
    duplicateFeedbackPercentage: SellerFlag.HighDuplicateFeedback,
    timeSinceCreation: SellerFlag.NewAccount,
};

export default function rateSeller(sellerStats: SellerStats): [number, SellerFlag[]] {
    const statsEntries = Object.entries(sellerStats) as [keyof SellerStats, number | TimeInfo][];

    let totalPositiveWeightedScore = 0;
    let totalNegativeWeightedScore = 0;
    let maximumPositiveScore = 0;
    let minimumNegativeScore = 0;

    const flags: SellerFlag[] = [];

    statsEntries.forEach(([key, value]) => {
        if (key == "timeSinceCreation") {
            const timeSinceCreation = value as TimeInfo;
            value = timeSinceCreation.days;
        }

        const factorMeta = factorValues[key];
        const normalizedValue = (value as number) / factorMeta.max;
        const normalizedValueAsPercent = normalizedValue * 100;

        // Weighted value can't go higher than its weight
        if (factorMeta.weight > 0) {
            const weightedValue = clamp(normalizedValue * factorMeta.weight, 0, factorMeta.weight);
            totalPositiveWeightedScore += weightedValue;
            maximumPositiveScore += factorMeta.weight;

            if (normalizedValueAsPercent < 20) {
                flags.push(factorFlags[key] as SellerFlag);
            }
        } else {
            const weightedValue = clamp(normalizedValue * factorMeta.weight, factorMeta.weight, 0);
            totalNegativeWeightedScore += weightedValue;
            minimumNegativeScore += factorMeta.weight;

            if (
                (key == "duplicateFeedbackPercentage" && normalizedValueAsPercent > 10) ||
                normalizedValueAsPercent > 65
            ) {
                flags.push(factorFlags[key] as SellerFlag);
            }
        }
    });

    const normalizedPositiveScore = (totalPositiveWeightedScore / maximumPositiveScore) * 100;
    const normalizedNegativeScore = (totalNegativeWeightedScore / minimumNegativeScore) * 100;

    const normalizedScore = clamp(normalizedPositiveScore - normalizedNegativeScore, 0, 100);

    return [normalizedScore, flags];
}
