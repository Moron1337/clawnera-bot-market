export const EXPLICIT_RUNTIME_SAME_ASSET_COUPLING = Object.freeze({
    disputeBond: "must_match_order_asset",
    managedStorageFee: "disabled",
});
export const SAME_ASSET_PAYMENT_CORE_LANES = Object.freeze([
    "listingCurrency",
    "bidCurrency",
    "orderCurrency",
    "typedOrderEscrowCreate",
    "disputeBond",
]);
export const SUI_ORDER_ESCROW_PAYMENT_LANES = Object.freeze([
    "listingCurrency",
    "bidCurrency",
    "orderCurrency",
    "typedOrderEscrowCreate",
]);
export const SAME_ASSET_OUT_OF_SCOPE_LANES = Object.freeze([
    "managedStorageFee",
    "listingDeposit",
    "reviewerStake",
    "reputationInit",
    "rewardsPayoutAccounting",
]);
function createNoProofNetworkFacts() {
    return {
        testnet: { proofStatus: "none" },
        mainnet: { proofStatus: "none" },
    };
}
export const LIVE_PUBLIC_MARKET_ASSET_DOSSIERS = Object.freeze({
    IOTA: {
        symbol: "IOTA",
        displayName: "IOTA",
        decimals: 9,
        fundingMode: "native_gas_split",
        feeMode: "iota_fee_path",
        publicStatus: "live",
        lanes: {
            listingCurrency: true,
            bidCurrency: true,
            orderCurrency: true,
            typedOrderEscrowCreate: true,
            managedStorageFee: true,
            sponsorReserve: true,
            sponsorExecute: true,
            disputeBond: true,
            reviewerStake: true,
            listingDeposit: true,
            reputationInit: true,
            rewardsPayoutAccounting: true,
            allowLegacyBoth: true,
        },
        networks: createNoProofNetworkFacts(),
    },
    CLAW: {
        symbol: "CLAW",
        displayName: "CLAW",
        decimals: 6,
        fundingMode: "typed_coin",
        feeMode: "generic_zero_fee",
        publicStatus: "live",
        lanes: {
            listingCurrency: true,
            bidCurrency: true,
            orderCurrency: true,
            typedOrderEscrowCreate: true,
            managedStorageFee: false,
            sponsorReserve: true,
            sponsorExecute: true,
            disputeBond: true,
            reviewerStake: false,
            listingDeposit: false,
            reputationInit: false,
            rewardsPayoutAccounting: false,
            allowLegacyBoth: true,
        },
        networks: {
            testnet: {
                packageId: "0xf35ee571c17a082b63a9f8bf934a2a05af59ca656596e8596d260f5cce956f4d",
                typeTag: "0xf35ee571c17a082b63a9f8bf934a2a05af59ca656596e8596d260f5cce956f4d::claw_coin::CLAW_COIN",
                proofStatus: "testnet_green",
            },
            mainnet: {
                packageId: "0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6",
                typeTag: "0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN",
                proofStatus: "mainnet_green",
            },
        },
    },
    SUI: {
        symbol: "SUI",
        displayName: "Native SUI on Sui",
        decimals: 9,
        fundingMode: "native_gas_split",
        feeMode: "generic_zero_fee",
        publicStatus: "live",
        lanes: {
            listingCurrency: true,
            bidCurrency: true,
            orderCurrency: true,
            typedOrderEscrowCreate: true,
            managedStorageFee: true,
            sponsorReserve: false,
            sponsorExecute: false,
            disputeBond: true,
            reviewerStake: true,
            listingDeposit: true,
            reputationInit: true,
            rewardsPayoutAccounting: false,
            allowLegacyBoth: false,
        },
        networks: {
            testnet: {
                packageId: "0x2",
                typeTag: "0x2::sui::SUI",
                proofStatus: "testnet_green",
            },
            mainnet: {
                packageId: "0x2",
                typeTag: "0x2::sui::SUI",
                proofStatus: "mainnet_green",
            },
        },
    },
    USDC: {
        symbol: "USDC",
        displayName: "Native USDC on Sui",
        decimals: 6,
        fundingMode: "typed_coin",
        feeMode: "exact_typed_fee_path",
        publicStatus: "live",
        lanes: {
            listingCurrency: true,
            bidCurrency: true,
            orderCurrency: true,
            typedOrderEscrowCreate: true,
            managedStorageFee: false,
            sponsorReserve: false,
            sponsorExecute: false,
            disputeBond: true,
            reviewerStake: false,
            listingDeposit: false,
            reputationInit: false,
            rewardsPayoutAccounting: false,
            allowLegacyBoth: false,
        },
        networks: {
            testnet: {
                packageId: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29",
                typeTag: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
                proofStatus: "testnet_green",
            },
            mainnet: {
                packageId: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7",
                typeTag: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
                proofStatus: "mainnet_green",
            },
        },
    },
});
// Experimental dossiers are planning/proof-branch inputs only. They must not
// widen main-runtime/API/DB truth on their own.
export const EXPERIMENTAL_MARKET_ASSET_CATALOG = Object.freeze({
    TESTUSD: {
        symbol: "TESTUSD",
        displayName: "CLAWDEX USDX Proof Coin",
        decimals: 6,
        fundingMode: "typed_coin",
        feeMode: "generic_zero_fee",
        publicStatus: "experimental",
        lanes: {
            listingCurrency: true,
            bidCurrency: true,
            orderCurrency: true,
            typedOrderEscrowCreate: true,
            managedStorageFee: false,
            sponsorReserve: true,
            sponsorExecute: true,
            disputeBond: true,
            reviewerStake: false,
            listingDeposit: false,
            reputationInit: false,
            rewardsPayoutAccounting: false,
            allowLegacyBoth: false,
        },
        networks: {
            testnet: {
                packageId: "0xa71d02ec25b81c20289d7ba79c6ebb2e313abdae78ade800049e5749d0eba097",
                typeTag: "0xa71d02ec25b81c20289d7ba79c6ebb2e313abdae78ade800049e5749d0eba097::usdx_coin::USDX_COIN",
                proofStatus: "testnet_green",
            },
            mainnet: { proofStatus: "none" },
        },
    },
});
export const ALL_KNOWN_MARKET_ASSET_DOSSIERS = Object.freeze({
    ...LIVE_PUBLIC_MARKET_ASSET_DOSSIERS,
    ...EXPERIMENTAL_MARKET_ASSET_CATALOG,
});
export const LIVE_SUPPORTED_MARKET_ASSET_SYMBOLS = Object.freeze(Object.keys(LIVE_PUBLIC_MARKET_ASSET_DOSSIERS));
export const EXPERIMENTAL_MARKET_ASSET_SYMBOLS = Object.freeze(Object.keys(EXPERIMENTAL_MARKET_ASSET_CATALOG));
export const ALL_KNOWN_MARKET_ASSET_SYMBOLS = Object.freeze(Object.keys(ALL_KNOWN_MARKET_ASSET_DOSSIERS));
function buildLanePolicy(dossiers) {
    const entries = Object.keys(dossiers).map((symbol) => [symbol, dossiers[symbol].lanes]);
    return Object.freeze(Object.fromEntries(entries));
}
export const LIVE_LANE_POLICY = buildLanePolicy(LIVE_PUBLIC_MARKET_ASSET_DOSSIERS);
export const EXPERIMENTAL_LANE_POLICY = buildLanePolicy(EXPERIMENTAL_MARKET_ASSET_CATALOG);
const MARKET_ASSET_LANE_NAMES = Object.freeze(Object.keys(LIVE_PUBLIC_MARKET_ASSET_DOSSIERS.IOTA.lanes));
const SPONSOR_RUNTIME_LANE_NAMES = Object.freeze(["sponsorReserve", "sponsorExecute"]);
function createEmptyRuntimeControlPlane() {
    const enabledByLane = MARKET_ASSET_LANE_NAMES.reduce((acc, lane) => {
        acc[lane] = [];
        return acc;
    }, {});
    return {
        enabledByLane,
        enabledBySymbol: {},
    };
}
function normalizeKnownMarketAssetSymbol(raw) {
    const normalized = raw.trim().toUpperCase();
    return isAnyKnownMarketAssetSymbol(normalized) ? normalized : undefined;
}
function enableRuntimeLane(controlPlane, symbol, lane) {
    const laneEntries = controlPlane.enabledByLane[lane];
    if (!laneEntries.includes(symbol)) {
        laneEntries.push(symbol);
    }
    const symbolEntry = (controlPlane.enabledBySymbol[symbol] ??= {});
    symbolEntry[lane] = true;
}
function applyRuntimeLaneOverlays(controlPlane, overlays, options = {}) {
    for (const overlay of overlays) {
        const dossier = ALL_KNOWN_MARKET_ASSET_DOSSIERS[overlay.symbol];
        for (const lane of MARKET_ASSET_LANE_NAMES) {
            if (!overlay.lanes[lane]) {
                continue;
            }
            if (SPONSOR_RUNTIME_LANE_NAMES.includes(lane)) {
                continue;
            }
            if (options.allowDossierClosedLanes || dossier.lanes[lane]) {
                enableRuntimeLane(controlPlane, overlay.symbol, lane);
            }
        }
    }
}
export function buildRuntimeMarketAssetControlPlane(input) {
    const controlPlane = createEmptyRuntimeControlPlane();
    for (const symbol of LIVE_SUPPORTED_MARKET_ASSET_SYMBOLS) {
        const dossier = LIVE_PUBLIC_MARKET_ASSET_DOSSIERS[symbol];
        for (const lane of MARKET_ASSET_LANE_NAMES) {
            if (SPONSOR_RUNTIME_LANE_NAMES.includes(lane)) {
                continue;
            }
            if (dossier.lanes[lane]) {
                enableRuntimeLane(controlPlane, symbol, lane);
            }
        }
    }
    for (const rawSymbol of input.sponsorAllowedPaymentCoins) {
        const symbol = normalizeKnownMarketAssetSymbol(rawSymbol);
        if (!symbol) {
            continue;
        }
        const dossier = ALL_KNOWN_MARKET_ASSET_DOSSIERS[symbol];
        for (const lane of SPONSOR_RUNTIME_LANE_NAMES) {
            if (dossier.lanes[lane]) {
                enableRuntimeLane(controlPlane, symbol, lane);
            }
        }
    }
    if (input.appEnv !== "prod") {
        applyRuntimeLaneOverlays(controlPlane, input.nonProdLaneOverlays);
    }
    applyRuntimeLaneOverlays(controlPlane, input.runtimeLaneOverlays ?? [], { allowDossierClosedLanes: true });
    return controlPlane;
}
export function runtimeSymbolsForLane(controlPlane, lane) {
    return [...controlPlane.enabledByLane[lane]];
}
export function runtimeSymbolEnabledForLane(controlPlane, symbol, lane) {
    return controlPlane.enabledBySymbol[symbol]?.[lane] === true;
}
export function buildRuntimeSameAssetPolicy(controlPlane, coupling = EXPLICIT_RUNTIME_SAME_ASSET_COUPLING) {
    const legacyBothAllowedSymbols = ALL_KNOWN_MARKET_ASSET_SYMBOLS.filter((symbol) => {
        const dossier = ALL_KNOWN_MARKET_ASSET_DOSSIERS[symbol];
        return (dossier.lanes.allowLegacyBoth &&
            runtimeSymbolEnabledForLane(controlPlane, symbol, "listingCurrency") &&
            runtimeSymbolEnabledForLane(controlPlane, symbol, "bidCurrency") &&
            runtimeSymbolEnabledForLane(controlPlane, symbol, "orderCurrency"));
    });
    return {
        orderAssetSource: "accepted_bid",
        disputeBond: coupling.disputeBond !== "disabled" && runtimeSymbolsForLane(controlPlane, "disputeBond").length > 0
            ? coupling.disputeBond
            : "disabled",
        managedStorageFee: coupling.managedStorageFee !== "disabled" && runtimeSymbolsForLane(controlPlane, "managedStorageFee").length > 0
            ? coupling.managedStorageFee
            : "disabled",
        legacyBothAllowedSymbols,
    };
}
export function isSupportedLiveMarketAssetSymbol(value) {
    return value in LIVE_PUBLIC_MARKET_ASSET_DOSSIERS;
}
export function isExperimentalCatalogAssetSymbol(value) {
    return value in EXPERIMENTAL_MARKET_ASSET_CATALOG;
}
export function isAnyKnownMarketAssetSymbol(value) {
    return value in ALL_KNOWN_MARKET_ASSET_DOSSIERS;
}
export function isLiveSymbolEnabledForLane(symbol, lane) {
    return LIVE_LANE_POLICY[symbol][lane];
}
export function supportedLiveSymbolsForLane(lane) {
    return LIVE_SUPPORTED_MARKET_ASSET_SYMBOLS.filter((symbol) => isLiveSymbolEnabledForLane(symbol, lane));
}
// Backward-compatible aliases while the repo finishes moving to the clearer
// live/experimental/all-known terminology.
export const EXPERIMENTAL_MARKET_ASSET_DOSSIERS = EXPERIMENTAL_MARKET_ASSET_CATALOG;
export const ALL_MARKET_ASSET_DOSSIERS = ALL_KNOWN_MARKET_ASSET_DOSSIERS;
export const SUPPORTED_LIVE_MARKET_ASSET_SYMBOLS = LIVE_SUPPORTED_MARKET_ASSET_SYMBOLS;
export const ALL_MARKET_ASSET_SYMBOLS = ALL_KNOWN_MARKET_ASSET_SYMBOLS;
export function isExperimentalMarketAssetSymbol(value) {
    return isExperimentalCatalogAssetSymbol(value);
}
export function isAnyMarketAssetSymbol(value) {
    return isAnyKnownMarketAssetSymbol(value);
}
//# sourceMappingURL=assetControlPlane.js.map