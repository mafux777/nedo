# Nedo

Use this script to take a snapshot of Interlay vault collaterals. 


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
  "block_hash": "0x3b2546bd62cfcf54c0a6ee8969a64734f3b336add552cac0eb2e108494fd9603",
  "block_number": 4073163,
  "ts": 1701302394,
  "section": "vaultRegistry",
  "storage": "vaults",
  "track": "vault-collateral",
  "track_val": "{\"lendToken\":3}",
  "source": "funkmeister380",
  "address_pubkey": "0xd80f45b79e911946059ae43aabd1ca2492ff93416b21418e6ca1538c1a782a27",
  "address_ss58": "wdCPB219aKcQQXt8QyXAhgcQgzWgVeRSe5j1MXU4yDeBG3Rwa",
  "kv": {
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
  "pv": {
    "collateral": "1045225.522263",
    "collateral_currency": "qUSDT",
    "raw_collateral": "0x0000000d314e49aabdf59d8272fc0000",
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
    "secureCollateralThreshold": null,
    "toBeIssuedTokens": 7900000,
    "issuedTokens": 29141815,
    "toBeRedeemedTokens": 0,
    "toBeReplacedTokens": 0,
    "replaceCollateral": 0,
    "activeReplaceCollateral": 0,
    "liquidatedCollateral": 0
  }
}
```

