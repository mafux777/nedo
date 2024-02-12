# Nedo

Use this script to take a snapshot of Interlay vault collaterals. 

For now, you need to separately clone this repo:

```bash
git clone https://github.com/interlay/interbtc-api
```

Clone this repository and enter into the root folder.

```bash
git@github.com:mafux777/nedo
cd nedo
yarn install
```

Compile typescript with `tsc`

Run the script with 

`node ./snapshot-interlay.js --start-date 2023-10-01 --parachain-endpoint wss://api.interlay.io:443/parachain`

The output will look like this:

```bash
polkadot/2032/2023/11/03/polkadot_snapshotsinterlay_log20231103_23.json
polkadot/2032/2023/11/04
polkadot/2032/2023/11/04/polkadot_snapshotsinterlay_log20231104_23.json
polkadot/2032/2023/11/05
polkadot/2032/2023/11/05/polkadot_snapshotsinterlay_log20231105_23.json
```

Each file has entries like this:

```json
{
  "chain_name": "Interlay",
  "block_hash": "0x549210c4ea4755b5c0059eb7d26b8466b6cc4d4fe6fea328c5dc4beaae2a2f33",
  "block_number": 3657407,
  "ts": 1696204788,
  "section": "vaultRegistry",
  "storage": "vaults",
  "track": "vault-collateral",
  "track_val": "{\"lendToken\":3}",
  "source": "funkmeister380",
  "address_pubkey": "0xd80f45b79e911946059ae43aabd1ca2492ff93416b21418e6ca1538c1a782a27",
  "address_ss58": "wdCPB219aKcQQXt8QyXAhgcQgzWgVeRSe5j1MXU4yDeBG3Rwa",
  "kv": "{\"accountId\":\"wdCPB219aKcQQXt8QyXAhgcQgzWgVeRSe5j1MXU4yDeBG3Rwa\",\"currencies\":{\"collateral\":{\"lendToken\":3},\"wrapped\":{\"token\":\"IBTC\"}}}",
  "pv": {
    "collateral": "542283.522263",
    "collateral_currency": "qUSDT",
    "raw_collateral": "0x00000006d8366a87082413ad14fc0000",
    "id": {
      "accountId": "wdCPB219aKcQQXt8QyXAhgcQgzWgVeRSe5j1MXU4yDeBG3Rwa",
      "currencies": {
        "collateral": {
          "lendToken": 3
        },
        "wrapped": {
          "token": "IBTC"
        }
      }
    },
    "status": {
      "active": true
    },
    "bannedUntil": null,
    "secureCollateralThreshold": "0x000000000000000017979cfe362a0000",
    "toBeIssuedTokens": 0,
    "issuedTokens": 24476086,
    "toBeRedeemedTokens": 0,
    "toBeReplacedTokens": 0,
    "replaceCollateral": 0,
    "activeReplaceCollateral": 0,
    "liquidatedCollateral": 0
  }
}
```

