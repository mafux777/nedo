import { cryptoWaitReady } from "@polkadot/util-crypto";
import { decodeAddress } from "@polkadot/keyring";
import {createInterBtcApi,
    currencyIdToMonetaryCurrency,
    decodeFixedPointType,
    LendToken,
    newMonetaryAmount,
    UndercollateralizedPosition
} from "@interlay/interbtc-api";
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
        demandOption: false, // Making it optional
    })
    .argv;

main().catch((err) => {
    console.log("Error thrown by script:");
    console.log(err);
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

function parseDateAndHour(dateStr: string) {
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


async function main(): Promise<void> {
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
        endDate = new Date(); // today!
    }
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
    for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
        const dataMapping: string[] = [];
        const dateString = d.toISOString().split("T")[0].replace(/-/g, "");
        const data = await fetchSnapshotData(2032, dateString, 0, 23);
        const last_hour = 23;
        if (data.length<last_hour){
            console.log(`We have reached the end of the road...`);
            break;
        }
        const my_blockhash = data[last_hour].end_blockhash; // last hour of the day
        if(!my_blockhash){
            console.log(`We have reached the end of the road...`);
            break;
        }
        const my_blockno = data[last_hour].endBN; // last block of that hour
        const chain_name = "Interlay";
        const ts = data[last_hour].endTS; // timestamp in Linux notation
        const section = "vaultRegistry";
        const storage = "vaults";
        const track = "vault-collateral";
        const source = "funkmeister380";

        console.log(`Connecting to parachain at ${my_blockhash}`);
        const temp_api = await interBtc.api.at(my_blockhash) as ApiPromise;
        const blockDate = await temp_api.query.timestamp.now();
        const blockTimestampISO = new Date(blockDate.toNumber()).toISOString();
        console.log(`Block date (ISO format): ${blockTimestampISO}`);

        const entries = await temp_api.query.vaultRegistry.vaults.entries();

        for (let i = 0; i < entries.length; i++) {
            const [, vaultData] = entries[i]; // Destructure to get the vaultData
            if(!vaultData.isSome) continue;
            //if(!vaultData) continue; // it looks like TS does not otherwise understand the previous line

            // Convert all the codecs to JSON to make life easier
            const my_vault_from_registry = vaultData.value;
            const collateral_currency = await currencyIdToMonetaryCurrency(interBtc.api,
                my_vault_from_registry.id.currencies.collateral);
            const track_value = JSON.stringify(my_vault_from_registry.id.currencies.collateral.toJSON());

            // const vaultId = newVaultId(interBtc.api, my_vault_from_registry.id.accountId.toString(),
            //      collateral_currency,
            //      InterBtc);
            // const rawNonce = await interBtc.api.query.vaultStaking.nonce(vaultId);
            // const nonce = rawNonce.toNumber(); // IT LOOKS LIKE THIS IS ALWAYS 0
            const nonce = 0; // IT LOOKS LIKE THIS IS ALWAYS 0

            const rawBackingCollateral = await temp_api.query.vaultStaking.totalCurrentStake(nonce,
                my_vault_from_registry.id);
            const ma = newMonetaryAmount(decodeFixedPointType(rawBackingCollateral),
                collateral_currency);
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
                address_pubkey: u8aToHex(decodeAddress(my_vault_from_registry.id.accountId)),
                address_ss58: my_vault_from_registry.id.accountId.toString(),
                kv: my_vault_from_registry.id.toJSON(),
                pv: {
                    collateral: ma_human,
                    collateral_currency: ma_ticker,
                    raw_collateral: rawBackingCollateral,
                    ...my_vault_from_registry.toJSON()
                }
            };

            dataMapping.push(JSON.stringify(my_vault)); // Store the date and the array of vault JSON objects in dataMapping
        }

        console.log(`Date: ${dateString}, Vault count: ${entries.length}`);
        // JSON Writing
        const relayChain = "polkadot";
        const paraID = "interlay";
        const paraNo = 2032;
        const logYYYYMMDD = `log${dateString}`;

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0"); // JavaScript months are 0-indexed.
        const day = String(d.getDate()).padStart(2, "0");

        // Construct the directory path dynamically
        const dirPath = `./${args["out"]}/${relayChain}/${paraNo}/${year}/${month}/${day}/`;

        // Ensure the directory exists
        fs.mkdirSync(dirPath, {recursive: true});

        // Construct the full file path
        const filePath = path.join(dirPath, `${relayChain}_snapshots${paraID}_${logYYYYMMDD}_23.json`);

        fs.writeFileSync(filePath, dataMapping.join("\n")); // one line per item
        console.log("Data written to JSON successfully.");
    }

    await interBtc.disconnect();
}
