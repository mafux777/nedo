-- refactored query

-- The logic of vault iterations changed over time.
-- That's why we filter out registrations after the introduction of "nomination" for collateral deposits
-- if you want to see registrations separately you would have to use the first nomination deposit of a vault
-- (only for vaults which don't have a registration event left in this table)
WITH FIRST_NOMINATION_EVENT AS
(
  SELECT MIN(block_time) as min_block_time
  FROM `substrate-etl.crypto_polkadot.events2032`
  WHERE (section='nomination' AND method='DepositCollateral')
),
COLLATERAL_SLASH AS
(
  SELECT
    'redeem' as section,
    'slashed' as method,
    event_id,
    block_time,
    account_id_vault as account,
    collateral_currency_symbol,
    (-slashed_collateral_human) as collateral_amount_value
  FROM `substrate-etl.polkadot_analytics.interlay_redeem_cancelled`
  ORDER BY block_time
),
COLLATERAL_RAW_UNION AS
(
  SELECT
    section,
    method,
    JSON_EXTRACT_SCALAR(data[0], '$.accountId') AS account,
    JSON_VALUE(data[0], '$.currencies.wrapped.token') AS wrapped_currency, -- assume wrapped token is always native
    JSON_VALUE(data[0], '$.currencies.collateral.token') as collateral_token,
    JSON_VALUE(data[0], '$.currencies.collateral.foreignAsset') as collateral_foreign,
    JSON_VALUE(data[0], '$.currencies.collateral.lendToken') as collateral_lend,
    -- depending on section, pick the correct element as collateral raw amount
    -- CASE WHEN finishes on first match
    CASE WHEN method='LiquidateVault' THEN CAST(JSON_VALUE(data[5], '$') AS BIGINT) -- only a few cases
      WHEN section='vaultRegistry' THEN CAST(JSON_VALUE(data[1], '$') AS BIGINT)
      ELSE CAST(JSON_VALUE(data[2], '$') AS BIGINT) END as collateral_raw,
    event_id,
    block_time
  FROM `substrate-etl.crypto_polkadot.events2032`
  WHERE (section='vaultRegistry' AND method='RegisterVault'
    and block_time<(
    SELECT min_block_time FROM FIRST_NOMINATION_EVENT LIMIT 1 -- THIS FILTERS OUT REGISTRATIONS AFTER NOMINATION INTRODUCED
  ))
  OR (section in ('nomination', 'vaultRegistry') and method in ('DepositCollateral', 'WithdrawCollateral', 'LiquidateVault'))
),
COLLATERAL AS(
SELECT
  section,
  method,
  event_id,
  block_time,
  account,
    CASE
      WHEN collateral_token IS NOT NULL THEN collateral_token
      WHEN collateral_foreign = '2' THEN 'USDT'
      WHEN collateral_foreign = '3' THEN 'VDOT'
      WHEN collateral_lend = '1' THEN 'qIBTC'
      WHEN collateral_lend = '2' THEN 'qDOT'
      WHEN collateral_lend = '3' THEN 'qUSDT'
      WHEN collateral_lend = '4' THEN 'qVDOT'
      ELSE 'Unknown'
    END AS collateral_currency_symbol,
    collateral_raw * CASE WHEN method IN ('WithdrawCollateral', 'LiquidateVault') THEN -1 ELSE 1 END
    /
      CASE
        WHEN collateral_token IN ('DOT') THEN POWER(10,10) # DOT
        WHEN collateral_foreign = '2'    THEN POWER(10,6)  #'USDT'
        WHEN collateral_foreign = '3'    THEN POWER(10,10) #'VDOT'
        WHEN collateral_lend = '2'       THEN POWER(10,10) #'qDOT'
        WHEN collateral_lend = '3'       THEN POWER(10,6)  #'qUSDT'
        WHEN collateral_lend = '4'       THEN POWER(10,10) #'qVDOT'
        ELSE 1 -- Default case if no mapping is found
      END AS collateral_amount_value,
FROM COLLATERAL_RAW_UNION
),
COMBINED_COLLATERAL_W_SLASHES AS(
SELECT *
FROM COLLATERAL
UNION ALL
SELECT * FROM COLLATERAL_SLASH
),
-- GROUP BY DATE allows to easily reconcile with the daily snapshots
GROUPED_BY_DATE AS(
  SELECT
  DATE(block_time) as block_time,
  SUM(collateral_amount_value) AS collateral_amount_value
  FROM COMBINED_COLLATERAL_W_SLASHES
  WHERE collateral_currency_symbol='USDT' --------------------------------- HARD CODED -----------------------
  GROUP BY 1
),
COLLATERAL_FROM_SNAPSHOT AS(
  SELECT
  date_trunc(DATE(TIMESTAMP(ts)), DAY) as `block_time`,
  --track_val as collateral_currency_raw,
  --JSON_VALUE(pv, '$.collateral_currency') as collateral_ticker,
  --(JSON_VALUE(kv, '$.accountId')) as vault,
  --(CAST(JSON_VALUE(pv, '$.issuedTokens') as INT64)/1e8) as issuedTokens, --always BTC
  SUM(CAST(JSON_VALUE(pv, '$.collateral') as NUMERIC)) as total_collateral,
  --(JSON_VALUE(pv, '$.raw_collateral')) as collateral_raw
  from `awesome-web3.polkadot_general.traces2032`
  where JSON_VALUE(pv, '$.collateral_currency')='USDT' ------------------- HARD CODED -----------------------
  GROUP BY 1
  ORDER BY 1
),
COLLATERAL_FROM_EVENTS AS(
SELECT
  GROUPED_BY_DATE.block_time,
  SUM(collateral_amount_value) OVER (ORDER BY DATE(block_time) ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS total_collateral
FROM GROUPED_BY_DATE
ORDER BY 1
)
SELECT
  S.block_time,
  S.total_collateral as snapshot,
  E.total_collateral as event,
  S.total_collateral - E.total_collateral as discrepancy,
  round((S.total_collateral - E.total_collateral)/S.total_collateral * 100,2) as discrepancy_ratio_pct
FROM COLLATERAL_FROM_SNAPSHOT S
INNER JOIN COLLATERAL_FROM_EVENTS E on S.block_time=E.block_time
ORDER BY 1


