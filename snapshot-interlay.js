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
    default: "/tmp",
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
function parseDateAndHour(dateStr) {
    let hour = null;
    // Split the input string to separate the date and possible hour parts
    const parts = dateStr.split(' ');
    // Append 'Z' to indicate UTC time if only the date part is provided or construct ISO string in UTC
    const isoDateStr = parts[0] + (parts.length > 1 ? `T${parts[1].padStart(2, '0')}:00:00Z` : "T00:00:00Z");
    // Create a Date object from the ISO string in UTC
    const date = new Date(isoDateStr);
    // If an hour part was provided, parse it as integer
    if (parts.length > 1) {
        hour = parseInt(parts[1], 10);
    }
    return { date, hour };
}
function convertToUnixTimestamp(datePart, hourPart) {
    // Clone the datePart to avoid mutating the original datePart
    const dateTime = new Date(datePart.getTime());
    // Ensure the hour part is correctly adjusted in UTC
    if (hourPart !== undefined && hourPart !== null) {
        // Use setUTCHours to correctly adjust the hour in UTC
        dateTime.setUTCHours(hourPart, 0, 0, 0); // Sets the hours, minutes, seconds, and milliseconds in UTC
    }
    // Convert the dateTime object to a Unix timestamp in milliseconds and then to seconds
    const unixTimestampInSeconds = Math.floor(dateTime.getTime() / 1000);
    return unixTimestampInSeconds;
}
// please consider extracting the fetch and processing into saperate function. so main can simply call it
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
            // Get the current date and time
            let now = new Date();
            // Subtract one hour from the current time
            now.setHours(now.getHours() - 1);
            // Adjust `now` to the start of that hour
            now.setMinutes(0, 0, 0); // Sets minutes, seconds, and milliseconds to 0
            endDate = now; // today!
        }
        let startTS = convertToUnixTimestamp(startDate, startHour);
        let endTS = convertToUnixTimestamp(endDate, endHour);
        console.log(`startDate=${startDate.toISOString()}. startHour=${startHour}. endDate=${endDate.toISOString()}. endHour=${endHour} (startTS=${startTS}, endTS=${endTS})`);
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
            const dataMapping = [];
            const dateString = d.toISOString().split("T")[0].replace(/-/g, "");
            const data = yield fetchSnapshotData(2032, dateString, 0, 23);
            console.log(`[${d}] data`, data);
            const last_hour = 23;
            for (const data_hr of data) {
                let target_indexTS = data_hr.indexTS;
                let target_hr = data_hr.hr;
                let targetHR = `${target_hr.toString().padStart(2, '0')}`;
                if (startTS <= target_indexTS && target_indexTS <= endTS) {
                    console.log(`[${d.toISOString()} targetHR=${targetHR}] proceed!!`);
                }
                else {
                    console.log(`[${d.toISOString()} targetHR=${targetHR}] SKIP!!`);
                    continue;
                }
                const my_blockhash = data_hr.end_blockhash; // last hour of the day
                if (!my_blockhash) {
                    console.log(`We have reached the end of the road...`);
                    break;
                }
                const my_blockno = data_hr.endBN; // last block of that hour
                const chain_name = "Interlay";
                const ts = data_hr.endTS; // timestamp in Linux notation
                const section = "vaultRegistry";
                const storage = "vaults";
                const track = "vault-collateral";
                const source = "funkmeister380";
                console.log(`Connecting to parachain at ${my_blockhash}`);
                const temp_api = yield interBtc.api.at(my_blockhash);
                const blockDate = yield temp_api.query.timestamp.now();
                const blockTimestampISO = new Date(blockDate.toNumber()).toISOString();
                console.log(`Block date (ISO format): ${blockTimestampISO}`);
                const entries = yield temp_api.query.vaultRegistry.vaults.entries();
                for (let i = 0; i < entries.length; i++) {
                    const [, vaultData] = entries[i]; // Destructure to get the vaultData
                    if (!vaultData.isSome)
                        continue;
                    //if(!vaultData) continue; // it looks like TS does not otherwise understand the previous line
                    // Convert all the codecs to JSON to make life easier
                    const my_vault_from_registry = vaultData.value;
                    const collateral_currency = yield (0, interbtc_api_1.currencyIdToMonetaryCurrency)(interBtc.api, my_vault_from_registry.id.currencies.collateral);
                    const track_value = JSON.stringify(my_vault_from_registry.id.currencies.collateral.toJSON());
                    // const vaultId = newVaultId(interBtc.api, my_vault_from_registry.id.accountId.toString(),
                    //      collateral_currency,
                    //      InterBtc);
                    // const rawNonce = await interBtc.api.query.vaultStaking.nonce(vaultId);
                    // const nonce = rawNonce.toNumber(); // IT LOOKS LIKE THIS IS ALWAYS 0
                    const nonce = 0; // IT LOOKS LIKE THIS IS ALWAYS 0
                    const rawBackingCollateral = yield temp_api.query.vaultStaking.totalCurrentStake(nonce, my_vault_from_registry.id);
                    const ma = (0, interbtc_api_1.newMonetaryAmount)((0, interbtc_api_1.decodeFixedPointType)(rawBackingCollateral), collateral_currency);
                    const ma_human = ma.toHuman();
                    const ma_ticker = ma.currency.ticker;
                    // print the amount
                    console.log(`${my_vault_from_registry.id.accountId.toString()}, Backing Collateral: ${ma_human} ${ma_ticker} Nonce ${nonce}`);
                    // Construct the final payload
                    const my_vault = {
                        chain_name: chain_name,
                        block_hash: my_blockhash,
                        block_number: my_blockno,
                        ts: ts,
                        section: section,
                        storage: storage,
                        track: track,
                        track_val: track_value,
                        source: source,
                        address_pubkey: (0, util_1.u8aToHex)((0, keyring_1.decodeAddress)(my_vault_from_registry.id.accountId)),
                        address_ss58: my_vault_from_registry.id.accountId.toString(),
                        kv: my_vault_from_registry.id.toJSON(),
                        pv: Object.assign({ collateral: ma_human, collateral_currency: ma_ticker, raw_collateral: rawBackingCollateral }, my_vault_from_registry.toJSON())
                    };
                    dataMapping.push(JSON.stringify(my_vault)); // Store the date and the array of vault JSON objects in dataMapping
                }
                console.log(`Date: ${dateString}, Vault count: ${entries.length}`);
                // JSON Writing
                const relayChain = "polkadot";
                const paraName = "interlay";
                const paraID = 2032;
                const logYYYYMMDD = `${dateString}`;
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, "0"); // JavaScript months are 0-indexed.
                const day = String(d.getDate()).padStart(2, "0");
                // Construct the directory path dynamically
                const dirPath = `${args["out"]}/${relayChain}/${paraID}/${year}/${month}/${day}/`;
                // Ensure the directory exists
                fs.mkdirSync(dirPath, { recursive: true });
                // Construct the full file path
                const filePath = path.join(dirPath, `${relayChain}_snapshots_${paraID}_${logYYYYMMDD}_${targetHR}.json`);
                fs.writeFileSync(filePath, dataMapping.join("\n")); // one line per item
                console.log(`Data written to ${filePath} JSON successfully`);
            }
        }
        yield interBtc.disconnect();
    });
}
//# sourceMappingURL=snapshot-interlay.js.map