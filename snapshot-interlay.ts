import { cryptoWaitReady } from "@polkadot/util-crypto";
import { StorageKey, u32 } from '@polkadot/types';
import {BareOpts, Inspect} from "@polkadot/types-codec/types/codec";
import { decodeAddress } from "@polkadot/keyring";
import {
    createInterBtcApi,
    currencyIdToMonetaryCurrency,
    decodeFixedPointType,
    LendToken,
    newMonetaryAmount,
    UndercollateralizedPosition,
    VaultRegistryVault,
    InterbtcPrimitivesVaultId
} from "@interlay/interbtc-api";
import { Option } from "@polkadot/types-codec"
import { u8aToHex } from '@polkadot/util';
import fetch from "node-fetch";
import {ApiPromise} from "@polkadot/api";
import type {IU8a} from "@polkadot/types-codec/types/interfaces";
import type {Registry} from "@polkadot/types-codec/types/registry";
import type {HexString} from "@polkadot/util/types";
import type {AnyJson, AnyTuple} from "@polkadot/types-codec/types/helpers";

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


// Function to parse date and optionally extract hour
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

interface JSONableCodec {
  toJSON(): any;
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
        // Simplified approach to set endDate to yesterday
        endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);
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
        // const dataMapping: string[] = [];
        const dateString = d.toISOString().split("T")[0].replace(/-/g, "");
        const data = await fetchSnapshotData(2032, dateString, 0, 23);
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
        const temp_api = await interBtc.api.at(my_blockhash) as ApiPromise;
        const blockDate = await temp_api.query.timestamp.now();
        const blockTimestampISO = new Date(blockDate.toNumber()).toISOString();
        console.log(`Block date (ISO format): ${blockTimestampISO}`);

        const vaultsWithCollateral: string[] = [];

        const vaultEntries = await temp_api.query.vaultRegistry.vaults.entries();
        // Assuming vaultEntries is an array of tuples, where each tuple consists of [StorageKey, Option<SomeType>]
        const filteredVaultEntries = vaultEntries.filter(([key,
                                                              optionValue]) => optionValue.isSome);
        const collateralPositions = await temp_api.query.vaultStaking.totalCurrentStake.entries();

        // Transform entries to a more usable form, extracting keys
        const transformVaultEntries = (entries: [any, any][]) =>
          entries.map(([key, value]) => {
            // Assuming the keys are for a map that takes an accountId
            const decodedKey = key.args.map((k: JSONableCodec) => k.toJSON());
            const payload = value as unknown as Option<VaultRegistryVault>;
            const payloadValue = payload.value;

            return { key: decodedKey[0], payloadValue };
          });        // Transform entries to extract keys and nonce for entriesB
        const CollateralWithNonce = (entries: [any, any][]) =>
          entries.map(([key, value]) => {
            // Assuming the first part of the key is the accountId, and the second part is the nonce
            const [nonce, accountId] = key.args.map((k: JSONableCodec) => k.toJSON());
            return { key: accountId, nonce, value };
          });

        const vaultArray = transformVaultEntries(filteredVaultEntries);
        const vaultCache = new Map<string, VaultRegistryVault>();
        vaultArray.forEach(vault => {
            vaultCache.set(JSON.stringify(vault.key), vault.payloadValue);
        });

        const collateralArray = CollateralWithNonce(collateralPositions);

        for(let collateralPosition of collateralArray){
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
        fs.mkdirSync(dirPath, {recursive: true});

        // Construct the full file path
        const filePath = path.join(dirPath, `${relayChain}_snapshots${paraID}_${logYYYYMMDD}_23.json`);


        // Now, vaultsWithCollateralAsJsonStrings is an array of strings, where each string is a JSON representation of the corresponding object in vaultWithCollateral
        fs.writeFileSync(filePath, vaultsWithCollateral.join("\n")); // one line per item
        console.log(`Data written to ${filePath} successfully.`);
    }

    await interBtc.disconnect();
}

