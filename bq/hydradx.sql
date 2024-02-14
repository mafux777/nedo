SELECT
section,
method,
count(*) as count,
min(block_time) as first_event,
max(block_time) as last_event

FROM `substrate-etl.crypto_polkadot.events2034`
GROUP BY 1, 2
ORDER BY 3 DESC

