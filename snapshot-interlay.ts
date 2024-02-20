import { cryptoWaitReady } from "@polkadot/util-crypto";
import { decodeAddress } from "@polkadot/keyring";
import {
    createInterBtcApi,
    currencyIdToMonetaryCurrency,
    decodeFixedPointType,
    LendToken,
    newMonetaryAmount,
    UndercollateralizedPosition,
    VaultRegistryVault,
} from "@interlay/interbtc-api";
import { Option } from "@polkadot/types-codec"
import { u8aToHex } from '@polkadot/util';
import fetch from "node-fetch";
import {ApiPromise} from "@polkadot/api";

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
    .option("start-date", { // Adding the start-date option
        description: "The start date in YYYY-MM-DD [h] format (hour optional)",
        type: "string",
        demandOption: true, // Making it required
    })
    .option("end-date", { // Adding the start-date option
        description: "The end date in YYYY-MM-DD [h] format (hour optional)",
        type: "string",
        demandOption: false, // Making it optional
    })
    .option("out", { // Adding the start-date option
        description: "The output directory (will be created if needed)",
        type: "string",
        default: "/tmp",
        demandOption: false, // Making it optional
    })
    .argv;

function main(){
    return fetchAndProcess();
}

main().catch((err) => {
    console.log("Error thrown by script:");
    console.log(err);
    process.exit(1)
});


function toPrintable(pos: UndercollateralizedPosition) {
    return {
        accountId: pos.accountId.toString(),
        shortfall: pos.shortfall.toHuman() + ` ${pos.shortfall.currency.ticker}`,
        // Round down amounts to 3 decimals
        collateralPositions: pos.collateralPositions.map(p => p.amount.toHuman(3) + ` ${p.amount.currency.ticker}`).join(" | "),
        borrowPositions: pos.borrowPositions.map(p => p.amount.toHuman(3) + ` ${p.amount.currency.ticker}`).join(" | "),
    };
}

type Snapshot = {
  snapshotDT: string;
  hr: number;
  indexTS: number;
  startBN: number;
  endBN: number;
  startTS: number;
  endTS: number;
  start_blockhash: string;
  end_blockhash: string;
};

async function fetchSnapshotData(chainId: number, logDT: string, startHR: number, finalHR: number): Promise<Snapshot[]> {
    const response = await fetch(`https://api.polkaholic.io/snapshot/${chainId}?logDT=${logDT}&startHR=${startHR}&finalHR=${finalHR}`);
    if (!response.ok) {
        throw new Error("Failed to fetch data");
    }
    const j: Snapshot[] = await response.json();
    return j;
}

function parseDateAndHour(dateStr: string): { date: Date; hour: number | null } {
    let hour: number | null = null;

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


interface JSONableCodec {
  toJSON(): any;
}


function convertToUnixTimestamp(datePart: Date, hourPart?: number | null): number {
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

async function fetchAndProcess(): Promise<void> {
    // Parse start date and optionally extract hour
    const { date: startDate, hour: startHour } = parseDateAndHour(args["start-date"]);

    let endDate;
    let endHour = null;

    if (args["end-date"]) {
        // If end date is provided, parse it in the same way as the start date
        const parsedEndDate = parseDateAndHour(args["end-date"]);
        endDate = parsedEndDate.date;
        endHour = parsedEndDate.hour;
    } else {
        // Get the current date and time
         let now = new Date();
         // Subtract one hour from the current time
         now.setHours(now.getHours() - 1);
         // Adjust `now` to the start of that hour
         now.setMinutes(0, 0, 0); // Sets minutes, seconds, and milliseconds to 0
         endDate = now; // today!
    }

    let startTS = convertToUnixTimestamp(startDate,startHour)
    let endTS = convertToUnixTimestamp(endDate, endHour)

    console.log(`startDate=${startDate.toISOString()}. startHour=${startHour}. endDate=${endDate.toISOString()}. endHour=${endHour} (startTS=${startTS}, endTS=${endTS})`);

    await cryptoWaitReady();
    console.log(`Connecting to parachain using ${args["parachain-endpoint"]}`);
    const interBtc = await createInterBtcApi(args["parachain-endpoint"]);

    // obtain a list of all LendTokens and cache them
    const lendTokensArray = await interBtc.loans.getLendTokens(); // LendToken is Currency
    const lendTokenCache = new Map<number, LendToken>();
    lendTokensArray.forEach(lendToken => {
        lendTokenCache.set(lendToken.lendToken.id, lendToken);
    });

    // Loop through all relevant dates
    const paraID = 2032;
    for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateString = d.toISOString().split("T")[0].replace(/-/g, "");
        const data = await fetchSnapshotData(paraID, dateString, 0, 23);
        console.log(`[${d}] data`, data)
        for (const data_hr of data) {
            let target_indexTS = data_hr.indexTS
            let target_hr = data_hr.hr
            let targetHR = `${target_hr.toString().padStart(2, '0')}`;
            if (startTS <= target_indexTS && target_indexTS <= endTS) {
                console.log(`[${d.toISOString()} targetHR=${targetHR}] proceed!!`)
            } else {
                console.log(`[${d.toISOString()} targetHR=${targetHR}] SKIP!!`)
                continue
            }
            const my_blockhash = data_hr.end_blockhash; // last hash of the hour in question
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
            const temp_api = await interBtc.api.at(my_blockhash) as ApiPromise;
            const blockDate = await temp_api.query.timestamp.now();
            const blockTimestampISO = new Date(blockDate.toNumber()).toISOString();
            console.log(`Block date (ISO format): ${blockTimestampISO}`);


            const vaultsWithCollateral: string[] = []; // this will be written to disk later

            let filteredVaultEntries;
            let collateralPositions;

            try {
                const vaultEntries = await temp_api.query.vaultRegistry.vaults.entries();
                filteredVaultEntries = vaultEntries.filter(([key, optionValue]) => optionValue.isSome);
                collateralPositions = await temp_api.query.vaultStaking.totalCurrentStake.entries();
            } catch (error: unknown) {
                console.error(`An error occurred when trying to get chain data from ${args["parachain-endpoint"]}:`, error);
                process.exit(1);
            }

            // Transform entries to a more usable form, extracting keys
            const transformVaultEntries = (entries: [any, any][]) =>
                entries.map(([key, value]) => {
                    // Assuming the keys are for a map that takes an accountId
                    const decodedKey = key.args.map((k: JSONableCodec) => k.toJSON());
                    const payload = value as unknown as Option<VaultRegistryVault>;
                    const payloadValue = payload.value;

                    return {key: decodedKey[0], payloadValue};
                });        // Transform entries to extract keys and nonce for entriesB
            const CollateralWithNonce = (entries: [any, any][]) =>
                entries.map(([key, value]) => {
                    const [nonce, accountId] = key.args.map((k: JSONableCodec) => k.toJSON());
                    return {key: accountId, nonce, value};
                });

            const vaultArray = transformVaultEntries(filteredVaultEntries);
            const vaultCache = new Map<string, VaultRegistryVault>();
            vaultArray.forEach(vault => {
                vaultCache.set(JSON.stringify(vault.key), vault.payloadValue);
            });

            const collateralArray = CollateralWithNonce(collateralPositions);

            for (let collateralPosition of collateralArray) {
                const vaultId = JSON.stringify(collateralPosition.key);
                const matchingVault = vaultCache.get(vaultId); // reference data for the vault itself
                console.log(`Found vault ${vaultId} with collateral ${collateralPosition.value}`)

                const rawBackingCollateral = collateralPosition ? collateralPosition.value.toString() : undefined;
                const collateral_currency = await currencyIdToMonetaryCurrency(interBtc.api,
                    matchingVault.id.currencies.collateral);
                const track_value = JSON.stringify(matchingVault.id.currencies.collateral.toJSON());

                const ma = newMonetaryAmount(decodeFixedPointType(rawBackingCollateral),
                    collateral_currency);
                const ma_human = ma.toHuman();
                const ma_ticker = ma.currency.ticker;

                const finalVault = {
                    chain_name: chain_name,
                    block_hash: my_blockhash,
                    block_number: my_blockno,
                    ts: ts,
                    section: section,
                    storage: storage,
                    track: track,
                    track_val: track_value,
                    source: source,
                    address_pubkey: u8aToHex(decodeAddress(matchingVault.id.accountId)),
                    address_ss58: matchingVault.id.accountId.toString(),
                    kv: matchingVault.key,
                    pv: {
                        collateral: ma_human,
                        collateral_currency: ma_ticker,
                        nonce: collateralPosition.nonce, // Include the nonce in the joined data
                        raw_collateral: rawBackingCollateral,
                        ...matchingVault.toJSON()
                    }

                };
                vaultsWithCollateral.push(JSON.stringify(finalVault));
            }

            console.log(`Date: ${dateString}, Vault count: ${vaultsWithCollateral.length}`);
            // JSON Writing
            const relayChain = "polkadot";
            const paraName = "interlay";
            //const logYYYYMMDD = `${dateString}`;

            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, "0"); // JavaScript months are 0-indexed.
            const day = String(d.getDate()).padStart(2, "0");

            // Construct the directory path dynamically
            const dirPath = `${args["out"]}/${relayChain}/${paraID}/${year}/${month}/${day}/`;

            // Ensure the directory exists
            fs.mkdirSync(dirPath, {recursive: true});

            // Construct the full file path
            const filePath = path.join(dirPath, `${relayChain}_snapshots_${paraID}_${dateString}_${targetHR}.json`);

            fs.writeFileSync(filePath, vaultsWithCollateral.join("\n")); // one line per item
            console.log(`Data written to ${filePath} JSON successfully`);
        }
    }
    await interBtc.disconnect();
}
