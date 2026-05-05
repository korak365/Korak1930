// Apify SDK - toolkit for building Apify Actors (https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

// Initialize Actor runtime
await Actor.init();

// Input structure defined in .actor/input_schema.json
const {
    startUrls = ['https://www.ubereats.com', 'https://www.doordash.com'],
    maxRequestsPerCrawl = 200,
    currency = 'USD'
} = (await Actor.getInput()) ?? {};

// Proxy configuration (recommended for production)
const proxyConfiguration = await Actor.createProxyConfiguration();

// NOTE: Delivery apps often render dynamically with JavaScript and use heavy client-side frameworks.
// This Cheerio-based crawler is fast but only works for static HTML or server-rendered pages.
// If target pages require JS rendering, migrate to PlaywrightCrawler.
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl,
    async requestHandler({ enqueueLinks, request, $, log }) {
        log.info('Processing', { url: request.loadedUrl });

        // Enqueue links found on listing pages to follow internal restaurant/menu links.
        // Adjust selectors in production for each target site.
        try {
            await enqueueLinks({
                globs: [
                    '**/store/**',
                    '**/restaurant/**',
                    '**/menu/**'
                ]
            });
        } catch (err) {
            log.warning('enqueueLinks failed', { error: err.message });
        }

        // Example: find menu item rows on a page.
        // These selectors are illustrative — update for each target site.
        const results = [];
        $('.menu-item, .menuItem, .dish, .menu-row, .menu-listing').each((i, el) => {
            const $el = $(el);
            const item = $el.find('.item-name, .title, h3, .dish-name').first().text().trim();
            let priceText = $el.find('.price, .item-price, .amount').first().text().trim();
            // Fallbacks if price is split into currency and amount
            if (!priceText) {
                const amount = $el.find('.amount').first().text().trim();
                const curr = $el.find('.currency').first().text().trim() || currency;
                priceText = amount ? `${curr} ${amount}` : null;
            }
            const restaurant = $('.restaurant-name, .store-name, h1').first().text().trim() || null;
            const url = request.loadedUrl;
            const source = request.loadedUrl.includes('ubereats') ? 'UberEats' : request.loadedUrl.includes('doordash') ? 'DoorDash' : 'unknown';

            if (item && priceText) {
                const priceNormalized = priceText.replace(/\u00A0/g, ' ').trim();
                results.push({
                    restaurant,
                    item,
                    price: priceNormalized,
                    currency,
                    source,
                    url,
                    fetchedAt: new Date().toISOString()
                });
            }
        });

        // Fallback parsing when no menu-item found
        if (results.length === 0) {
            const title = $('h1, .restaurant-name, .store-name').first().text().trim();
            $('li, .menu-row, .menu-item').slice(0, 200).each((i, node) => {
                const $n = $(node);
                const item = $n.find('.item-name, .title, span').first().text().trim();
                const price = $n.find('.price, .amount').first().text().trim();
                if (item && price) {
                    results.push({
                        restaurant: title || null,
                        item,
                        price,
                        currency,
                        source: request.loadedUrl.includes('ubereats') ? 'UberEats' : request.loadedUrl.includes('doordash') ? 'DoorDash' : 'unknown',
                        url: request.loadedUrl,
                        fetchedAt: new Date().toISOString()
                    });
                }
            });
        }

        for (const r of results) {
            log.info('Saving menu item', { item: r.item, restaurant: r.restaurant, url: r.url });
            await Dataset.pushData(r);
        }
    }
});

await crawler.run(startUrls);

await Actor.exit();