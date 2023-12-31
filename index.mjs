// Importing all necessary dependencies
import QuickChart from 'quickchart-js';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';
import axios from 'axios';

dotenv.config();


// Creating global variables that store our API credentials and other necessary information
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const clientId = process.env.IMGUR_CLIENT_ID;

// This function is used to access the data from a Notion database given the database ID
async function queryDatabase(databaseId) {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
        });
        return response.results;
    } catch (error) {
        console.log('Query Database :: ', error.body);
    }
}

// This function is used to access up to 50 child blocks per page given the page ID
async function getChildBlocks(pageId) {
    try {
        const response = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 50,
        });
        return response.results;
    } catch (error) {
        console.log('Get Child Blocks ::', error.body);
    }
}

// This function will access the data from the given database, generate a chart with QuickChart,
// and return the QuickChart URL containing the chart image 
// GroupBy field should be the name of the select field
async function getChart(databaseId, chartType, plotType, groupBy) {

    const data = await queryDatabase(databaseId)
        .then(async results => {
            // Maps tag and amount spend
            const tags = {};
            let total = 0;
            for (let i = 0; i < results.length; i++) {
                const pageId = results[i].id;
                const groupByFieldId = results[i].properties[groupBy].id;
                const amountId = results[i].properties.Amount.id;
                try {
                    const groupByFieldValue = await notion.pages.properties.retrieve({ page_id: pageId, property_id: groupByFieldId });
                    const amountVal = await notion.pages.properties.retrieve({ page_id: pageId, property_id: amountId });
                    const name = groupByFieldValue.select.name;
                    const amount = amountVal.number;
                    total += amount;
                    tags[name] = name in tags ? tags[name] + amount : amount;
                } catch (error) {
                    console.log('Get Chart :: ', error.body);
                }
            }

            let dataPts = Object.values(tags);
            dataPts = plotType === 'percentage' ? dataPts.map(pts => (pts / total * 100).toFixed(2)) : dataPts;
            return { labels: Object.keys(tags), dataPts: dataPts };
        });

    const myChart = new QuickChart();
    myChart.setConfig({
        type: chartType,
        data: {
            labels: data.labels,
            datasets: [{ label: 'Amount', data: data.dataPts }]
        },
    })
        .setWidth(800)
        .setHeight(400)
        .setBackgroundColor('transparent');

    // the chart URL
    // console.log(myChart.getUrl());
    return myChart.getUrl();
}


// This function will take the QuickChart link and upload it to Imgur and return the Imgur link
async function swapLinks(clientId, chartlink) {

    const imgurLink = await axios
        .post('https://api.imgur.com/3/image', chartlink, {
            headers: {
                Accept: "application/json",
                Authorization: `Client-ID ${clientId}`,
            },
        })
        .then(({ data }) => {
            return data.data.link;
        });

    console.log(imgurLink);
    return imgurLink;
}

// getChart(databaseId, 'pie').then(chartUrl => swapLinks(clientId, chartUrl));

// getChart(databaseId, 'pie');


// Will search through the results array, get each blockId, and replace
// all image blocks with the imgUrls array argument in order
async function replaceCharts(pageId, imgUrls) {
    const results = await getChildBlocks(pageId);
    // Get locations and ID's for previous images

    const allBlockIds = [];
    const indexLocations = [];

    // Reconstruct the children array + gather all ID's
    const hasImage = results.some(res => res.type === 'image');

    // If image block is not available create, one. We will go for a better approach later
    const children = new Array(hasImage ? results.length : results.length + 1).fill(0);

    // FIXME:: Make it more generic 
    for (let i = 0; i < results.length; i++) {
        allBlockIds.push(results[i].id)

        // If block is an image, store it in prevImage cache and save index
        // If not, store the block as-is into children array
        if (results[i].type == 'image') {
            indexLocations.push(i);
        } else {
            const dataType = results[i]['type'];
            children[i] = { [dataType]: results[i][dataType] };
        }
    }

    if (indexLocations.length === 0) {
        indexLocations.push(results.length);
    }

    // Now add new images to children array
    for (let i = 0; i < imgUrls.length; i++) {
        const img =
        {
            "image": {
                "caption": [],
                "type": "external",
                "external": {
                    "url": imgUrls[i],
                }
            },
        }
        const index = indexLocations.shift();
        children[index] = img;
    }

    // Go through all current blocks, delete, then append children
    for (let i = 0; i < allBlockIds.length; i++) {
        await notion.blocks.delete({
            block_id: allBlockIds[i],
        });
    }

    // Append children
    await notion.blocks.children.append({
        block_id: pageId,
        children: children,
    });
}

// The main driver of the program
async function refreshPage(databaseId, pageId, clientId, chartType, plotType, groupBy) {

    // 1 - Get the QuickChart link from getChart()
    const quickChart = await getChart(databaseId, chartType, plotType, groupBy);

    // 2 - Swap links from QuickChart to Imgur
    const imgurUrl = await swapLinks(clientId, quickChart);

    // 3 - Replace images on Notion page
    replaceCharts(pageId, [imgurUrl]);
}

// replaceCharts(pageId, ['https://i.imgur.com/XwU6DJt.png']);
await refreshPage(databaseId, pageId, clientId, 'pie', 'percentage', 'Tags');

// export const handler = async (event) => {
//     await refreshPage(databaseId, pageId, clientId, 'pie');
//     const response = {
//         statusCode: 200,
//         body: JSON.stringify('Success!'),
//     };
//     return response;
// };


/**
 * Returns column name
 */
async function getColumnNames() {
    const response = await notion.databases.retrieve({ database_id: databaseId });
    return Object.keys(response.properties);
}