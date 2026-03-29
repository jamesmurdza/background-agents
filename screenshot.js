const puppeteer = require('puppeteer-core');

async function takeScreenshot() {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to a web page
    console.log('Navigating to https://example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle0' });

    // Take a screenshot
    const screenshotPath = '/home/daytona/sandboxed-agents/screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    await browser.close();
    console.log('Done!');
}

takeScreenshot().catch(console.error);
