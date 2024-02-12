import { cryptoWaitReady } from "@polkadot/util-crypto";
import { decodeAddress } from "@polkadot/keyring";
import {createInterBtcApi,
    currencyIdToMonetaryCurrency,
    decodeFixedPointType,
    LendToken,
    newMonetaryAmount,
    UndercollateralizedPosition
} from "@interlay/interbtc";
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



async function main(): Promise<void> {
    const startDate = new Date("2023-11-29");
    const endDate = new Date(new Date().setDate(new Date().getDate() - 1)); // Yesterday

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
        const dirPath = `./${relayChain}/${paraNo}/${year}/${month}/${day}/`;

        // Ensure the directory exists
        fs.mkdirSync(dirPath, {recursive: true});

        // Construct the full file path
        const filePath = path.join(dirPath, `${relayChain}_snapshots${paraID}_${logYYYYMMDD}_23.json`);

        fs.writeFileSync(filePath, dataMapping.join("\n")); // one line per item
        console.log("Data written to JSON successfully.");
    }

    await interBtc.disconnect();
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

