import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

type AssetAttributes = {
    id: number,
    name: string,
    symbol: string,
    decimals: number,
    type: string
};

async function readAssetsFromFile(filePath: string): Promise<Map<number, AssetAttributes>> {
    const fileContent = readFileSync(filePath, { encoding: 'utf-8' });
    const records: any[] = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
    });

    const assetsMap = new Map<number, AssetAttributes>();

    records.forEach(record => {
        // Explicitly convert 'id' and 'decimals' to numbers
        const assetID = parseInt(record.id, 10);
        const decimals = parseInt(record.decimals, 10);

        // Create a new AssetAttributes object, including type conversions
        const assetAttributes: AssetAttributes = {
            id: assetID,
            name: record.name,
            symbol: record.symbol,
            decimals: decimals,
            type: record.type
        };

        assetsMap.set(assetID, assetAttributes);
    });

    return assetsMap;
}

// Usage example
const filePath = './hydradx/assets.csv'; // Adjust the file path as needed
readAssetsFromFile(filePath)
    .then(assetsMap => {
        console.log('Assets Map:', assetsMap);
    })
    .catch(error => {
        console.error('Error reading assets from file:', error);
    });
