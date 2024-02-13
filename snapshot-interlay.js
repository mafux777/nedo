"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_crypto_1 = require("@polkadot/util-crypto");
const keyring_1 = require("@polkadot/keyring");
const interbtc_api_1 = require("@interlay/interbtc-api");
const util_1 = require("@polkadot/util");
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs = require('fs');
const Table = require("cli-table3");
const yargs = require("yargs/yargs");
const path = require('path');
const { hideBin } = require("yargs/helpers");
const args = yargs(hideBin(process.argv))
    .option("parachain-endpoint", {
    description: "The wss url of the parachain",
    type: "string",
    demandOption: true,
})
    .option("start-date", {
    description: "The start date in YYYY-MM-DD [h] format (hour optional)",
    type: "string",
    demandOption: true, // Making it required
})
    .option("end-date", {
    description: "The end date in YYYY-MM-DD [h] format (hour optional)",
    type: "string",
    demandOption: false, // Making it optional
})
    .option("out", {
    description: "The output directory (will be created if needed)",
    type: "string",
    demandOption: false, // Making it optional
})
    .argv;
main().catch((err) => {
    console.log("Error thrown by script:");
    console.log(err);
});
function toPrintable(pos) {
    return {
        accountId: pos.accountId.toString(),
        shortfall: pos.shortfall.toHuman() + ` ${pos.shortfall.currency.ticker}`,
        // Round down amounts to 3 decimals
        collateralPositions: pos.collateralPositions.map(p => p.amount.toHuman(3) + ` ${p.amount.currency.ticker}`).join(" | "),
        borrowPositions: pos.borrowPositions.map(p => p.amount.toHuman(3) + ` ${p.amount.currency.ticker}`).join(" | "),
    };
}
function fetchSnapshotData(chainId, logDT, startHR, finalHR) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield (0, node_fetch_1.default)(`https://api.polkaholic.io/snapshot/${chainId}?logDT=${logDT}&startHR=${startHR}&finalHR=${finalHR}`);
        if (!response.ok) {
            throw new Error("Failed to fetch data");
        }
        const j = yield response.json();
        return j;
    });
}
// Function to parse date and optionally extract hour
function parseDateAndHour(dateStr) {
    let date = new Date(dateStr);
    let hour = null;
    // Check if the input string contains an hour part
    if (dateStr.includes(' ')) {
        const parts = dateStr.split(' ');
        date = new Date(parts[0]); // Update date to exclude time part
        hour = parseInt(parts[1], 10); // Extract hour as integer
    }
    return { date, hour };
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Parse start date and optionally extract hour
        const { date: startDate, hour: startHour } = parseDateAndHour(args["start-date"]);
        let endDate;
        let endHour = null;
        if (args["end-date"]) {
            // If end date is provided, parse it in the same way as the start date
            const parsedEndDate = parseDateAndHour(args["end-date"]);
            endDate = parsedEndDate.date;
            endHour = parsedEndDate.hour;
        }
        else {
            // Simplified approach to set endDate to yesterday
            endDate = new Date();
            endDate.setDate(endDate.getDate() - 1);
        }
        yield (0, util_crypto_1.cryptoWaitReady)();
        console.log(`Connecting to parachain using ${args["parachain-endpoint"]}`);
        const interBtc = yield (0, interbtc_api_1.createInterBtcApi)(args["parachain-endpoint"]);
        // obtain a list of all LendTokens and cache them
        const lendTokensArray = yield interBtc.loans.getLendTokens(); // LendToken is Currency
        const lendTokenCache = new Map();
        lendTokensArray.forEach(lendToken => {
            lendTokenCache.set(lendToken.lendToken.id, lendToken);
        });
        // Loop through all relevant dates
        for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
            // const dataMapping: string[] = [];
            const dateString = d.toISOString().split("T")[0].replace(/-/g, "");
            const data = yield fetchSnapshotData(2032, dateString, 0, 23);
            const last_hour = 23;
            const my_blockhash = data[last_hour].end_blockhash; // last hour of the day
            const my_blockno = data[last_hour].endBN; // last block of that hour
            const chain_name = "Interlay";
            const ts = data[last_hour].endTS; // timestamp in Linux notation
            const section = "vaultRegistry";
            const storage = "vaults";
            const track = "vault-collateral";
            const source = "funkmeister380";
            console.log(`Connecting to parachain at ${my_blockhash}`);
            const temp_api = yield interBtc.api.at(my_blockhash);
            const blockDate = yield temp_api.query.timestamp.now();
            const blockTimestampISO = new Date(blockDate.toNumber()).toISOString();
            console.log(`Block date (ISO format): ${blockTimestampISO}`);
            const vaultEntries = yield temp_api.query.vaultRegistry.vaults.entries();
            // Assuming vaultEntries is an array of tuples, where each tuple consists of [StorageKey, Option<SomeType>]
            const filteredVaultEntries = vaultEntries.filter(([key, optionValue]) => optionValue.isSome);
            const collateralPositions = yield temp_api.query.vaultStaking.totalCurrentStake.entries();
            // Transform entries to a more usable form, extracting keys
            const transformVaultEntries = (entries) => entries.map(([key, value]) => {
                // Assuming the keys are for a map that takes an accountId
                const decodedKey = key.args.map((k) => k.toJSON());
                return { key: decodedKey, value };
            }); // Transform entries to extract keys and nonce for entriesB
            const CollateralWithNonce = (entries) => entries.map(([key, value]) => {
                // Assuming the first part of the key is the accountId, and the second part is the nonce
                const [nonce, accountId] = key.args.map((k) => k.toJSON());
                return { key: accountId, nonce, value };
            });
            const vaultArray = transformVaultEntries(filteredVaultEntries);
            const collateralArray = CollateralWithNonce(collateralPositions);
            // Join data based on the accountId, taking nonce into account for entriesB
            const vaultWithCollateral = (vaultArray.map((vault) => {
                const matchingCollateral = (collateralArray.find((collateralPosition) => vault.key.toString() === collateralPosition.key.toString()));
                if (!vault.value.isSome) {
                    console.log(`${vault.key} seems to be undefined`);
                }
                const track_value = JSON.stringify(vault.key[0].currencies.collateral);
                const nonce = matchingCollateral ? matchingCollateral.nonce : undefined;
                const rawBackingCollateral = matchingCollateral ? matchingCollateral.value.toJSON() : undefined;
                if (!rawBackingCollateral || !nonce) {
                    console.log(`It would appear that ${vault.key.toString()} does not have collateral.`);
                }
                return {
                    //key: itemA.key,
                    //valueA: vault.value,
                    //valueB: matchingCollateral ? matchingCollateral.value : undefined,
                    // ---
                    chain_name: chain_name,
                    block_hash: my_blockhash,
                    block_number: my_blockno,
                    ts: ts,
                    section: section,
                    storage: storage,
                    track: track,
                    track_val: track_value,
                    source: source,
                    address_pubkey: (0, util_1.u8aToHex)((0, keyring_1.decodeAddress)(vault.key[0].accountId)),
                    address_ss58: vault.key[0].accountId.toString(),
                    kv: vault.key[0],
                    pv: Object.assign({ 
                        // collateral: ma_human,
                        // collateral_currency: ma_ticker,
                        nonce: nonce, raw_collateral: matchingCollateral ? matchingCollateral.value : undefined, raw_collateral_j: matchingCollateral ? matchingCollateral.value.toJSON() : undefined, raw_collateral_s: matchingCollateral ? matchingCollateral.value.toString() : undefined, raw_collateral_h: matchingCollateral ? matchingCollateral.value.toHuman() : undefined, raw_collateral_b: matchingCollateral ? matchingCollateral.value.toBn() : undefined }, vault.value.toJSON())
                };
            }));
            console.log(vaultWithCollateral);
            // const collateral_currency = await currencyIdToMonetaryCurrency(interBtc.api,
            //     my_vault_from_registry.id.currencies.collateral);
            // const track_value = JSON.stringify(my_vault_from_registry.id.currencies.collateral.toJSON());
            //     const rawBackingCollateral = await temp_api.query.vaultStaking.totalCurrentStake(nonce,
            //         my_vault_from_registry.id);
            //     const ma = newMonetaryAmount(decodeFixedPointType(rawBackingCollateral),
            //         collateral_currency);
            //     const ma_human = ma.toHuman();
            //     const ma_ticker = ma.currency.ticker;
            //     // print the amount
            //
            //     console.log(`${my_vault_from_registry.id.accountId.toString()}, Backing Collateral: ${ma_human} ${ma_ticker} Nonce ${nonce}`);
            //
            console.log(`Date: ${dateString}, Vault count: ${vaultEntries.length}`);
            // JSON Writing
            const relayChain = "polkadot";
            const paraID = "interlay";
            const paraNo = 2032;
            const logYYYYMMDD = `log${dateString}`;
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, "0"); // JavaScript months are 0-indexed.
            const day = String(d.getDate()).padStart(2, "0");
            // Construct the directory path dynamically
            const dirPath = `./${relayChain}/${paraNo}/${year}/${month}/${day}/`;
            // Ensure the directory exists
            fs.mkdirSync(dirPath, { recursive: true });
            // Construct the full file path
            const filePath = path.join(dirPath, `${relayChain}_snapshots${paraID}_${logYYYYMMDD}_23.json`);
            // Transform the array of objects into an array of JSON strings
            const vaultsWithCollateralAsJsonStrings = vaultWithCollateral.map(vault => JSON.stringify(vault));
            // Now, vaultsWithCollateralAsJsonStrings is an array of strings, where each string is a JSON representation of the corresponding object in vaultWithCollateral
            fs.writeFileSync(filePath, vaultsWithCollateralAsJsonStrings.join("\n")); // one line per item
            console.log("Data written to JSON successfully.");
        }
        yield interBtc.disconnect();
    });
}
/*
    // try out polkaholic API
    const data = await fetchSnapshotData(2032, "20240101", 0, 23);
    console.log(data);
    const my_blockhash = data[0].end_blockhash;

    await cryptoWaitReady();

    console.log(`Connecting to parachain using ${args["parachain-endpoint"]} at ${my_blockhash}`);
    const interBtc = await createInterBtcApi(args["parachain-endpoint"], undefined, my_blockhash);
    //const interBtc2 = await interBtc.api.at(my_blockhash);

    // get all vault collateral positions
    const vault_list = await interBtc.vaults.list();
    //const vault_list = (await interBtc2.query.vaults.list()) as VaultExt[];
    console.table(vault_list);

    //
    const bannedVaults = vault_list.filter(vault => vault.bannedUntil);
    bannedVaults.forEach(vault => {
      console.log(`Vault Name: ${vault.id}, Banned Until: ${vault.bannedUntil}`);
    });

    // get the account ID corresponding to "wdBcednk8i9t7xYjkWM9rTtrix1V4oWBRkEhkF89xvS2tu5iY"
    const accountId = interBtc.api.createType(
        "AccountId",
        "wdBcednk8i9t7xYjkWM9rTtrix1V4oWBRkEhkF89xvS2tu5iY"
    );

    const fa_1 = await interBtc.assetRegistry.getForeignAsset(3);
    const api = interBtc.api;

    const latestHeader = await api.rpc.chain.getHeader();

    const fa_2 = await getForeignAssetFromId(api, 3);
    console.log(fa_2);

    // check currency metadata
    const foreignAssets = await interBtc.assetRegistry.getForeignAssets();
    // Constructing an object of ForeignAsset type with minimal attributes using type assertion
    const vault_collateral = await interBtc.vaults.get(accountId, fa_1);
    const flattenedData = foreignAssets.map(item => ({
        id: item.foreignAsset.id,
        coingeckoId: item.foreignAsset.coingeckoId,
        name: item.name,
        ticker: item.ticker,
        decimals: item.decimals
    }));

    // get Loan Assets from the API
    const loan_assets = await interBtc.loans.getLoanAssets();
*/
//# sourceMappingURL=snapshot-interlay.js.map