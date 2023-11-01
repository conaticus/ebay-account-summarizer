import puppeteer, { Browser, ElementHandle, Page } from "puppeteer";
import { TimeInfo, getTimeSince } from "../util/dates";

export interface SellerStats {
    activeItems: number; // We only fetch a maximum of 60 items on the first page for now (default)
    soldItems: number;

    cheapItemsPercentage: number; // Percentage of items under £5 for sale
    averageImageCount: number;

    averageDescriptionLength: number;
    acceptReturnsPercentage: number;
    sellerPaysReturnsPercentage: number;
    freePostagePercentage: number;

    feedbackCount: number;
    positiveFeedbackPercentage: number;
    duplicateFeedbackPercentage: number;

    timeSinceCreation?: TimeInfo;
}

interface PostageDetails {
    allowsPostage: boolean;
    isFree: boolean;
}

interface ReturnDetails {
    returnAllowed: boolean;
    sellerPays: boolean;
}

// The criteria for an item to be classified as "cheap"
const CHEAP_ITEM_CRITERIA = 10;

export default class SellerScraper {
    private page?: Page;
    private browser?: Browser;

    public sellerStats: SellerStats = {
        activeItems: 0,
        soldItems: 0,
        cheapItemsPercentage: 0,
        averageImageCount: 0,
        averageDescriptionLength: 0,
        acceptReturnsPercentage: 0,
        sellerPaysReturnsPercentage: 0,
        freePostagePercentage: 0,
        feedbackCount: 0,
        positiveFeedbackPercentage: 0,
        duplicateFeedbackPercentage: 0,
    };

    constructor(private username: string) {}

    public async scrapeSellerData(): Promise<void> {
        await this.setupSellerScraper();
        await this.getSoldItems();
        await this.getCheapItemsPercentage();
        await this.browseItemDetails();
        await this.browseSellerFeedback();
        await this.getAccountAge();
    }

    async getAccountAge() {
        await this.page?.goto(`https://www.ebay.co.uk/usr/${this.username}?_tab=1`, { waitUntil: "load" });
        const sellerInfos = await this.page?.$$(
            ".str-about-description__seller-info span.str-text-span.BOLD"
        );

        const creationDate = (await sellerInfos?.at(1)?.evaluate((el) => el.textContent)) as string;
        this.sellerStats.timeSinceCreation = getTimeSince(new Date(creationDate));
    }

    async setupSellerScraper() {
        this.browser = await puppeteer.launch({
            headless: "new",
            args: [`--proxy-server=${process.env.PROXY_ADDRESS}`, "--ignore-certificate-errors"],
        });

        this.page = await this.browser.newPage();

        await this.page.authenticate({
            username: process.env.PROXY_USERNAME as string,
            password: process.env.PROXY_PASSWORD as string,
        });

        await this.page.goto(`https://www.ebay.co.uk/sch/i.html?_ssn=${this.username}`, {
            waitUntil: "load",
        });
    }

    async getSoldItems() {
        const sellerStatsContainer = await this.page?.$(".str-seller-card__stats-content");
        const sellerStats = await sellerStatsContainer?.$$("div");

        const soldItemsText = await sellerStats?.at(1)?.evaluate((el) => el.getAttribute("title"));

        this.sellerStats.soldItems = Number(soldItemsText?.split(" ")[0]);
    }

    async getCheapItemsPercentage() {
        const itemPriceElements = await this.page?.$$(".s-item__price");

        let priceCount = 0;
        let cheapPriceCount = 0;

        // TODO: Ensure this works on other profiles too
        itemPriceElements?.shift(); // Remove honeypot

        const tasks = itemPriceElements?.map(async (item) => {
            const priceText = await item.evaluate((el) => el.textContent);
            const price = parseFloat(priceText?.slice(1) as string);

            priceCount++;
            if (price <= CHEAP_ITEM_CRITERIA) cheapPriceCount++;
        }) as Promise<void>[];

        await Promise.all(tasks);

        this.sellerStats.cheapItemsPercentage = (cheapPriceCount / priceCount) * 100;
    }

    async browseItemDetails() {
        const itemLinks = (await this.page?.$$(".s-item__link")) as ElementHandle<Element>[];

        // TODO: Ensure this works on other profiles too
        itemLinks?.shift(); // Remove honeypot
        this.sellerStats.activeItems = itemLinks.length;

        let totalImageCount = 0;
        let totalDescriptionLength = 0;

        let allowPostageCount = 0;
        let freePostageCount = 0;

        let acceptReturnsCount = 0;
        let sellerPaysReturnPostageCount = 0;

        for (const linkTag of itemLinks) {
            const link = (await linkTag.evaluate((el) => el.getAttribute("href"))) as string;

            const itemPage = (await this.browser?.newPage()) as Page;
            try {
                await itemPage?.goto(link);
            } catch {
                continue;
            }

            totalImageCount += await this.getItemImageCount(itemPage);
            totalDescriptionLength += await this.getItemDescriptionLength(itemPage);

            const postageDetails = await this.getPostageDetails(itemPage);
            allowPostageCount += Number(postageDetails.allowsPostage);
            freePostageCount += Number(postageDetails.isFree);

            const returnDetails = await this.getReturnDetails(itemPage);
            acceptReturnsCount += Number(returnDetails.returnAllowed);
            sellerPaysReturnPostageCount += Number(returnDetails.sellerPays);

            await itemPage?.close();
        }

        this.sellerStats.averageImageCount = totalImageCount / this.sellerStats.activeItems || 0;

        this.sellerStats.averageDescriptionLength =
            totalDescriptionLength / this.sellerStats.activeItems || 0;

        this.sellerStats.freePostagePercentage = (freePostageCount / allowPostageCount) * 100 || 0;

        this.sellerStats.acceptReturnsPercentage =
            (acceptReturnsCount / this.sellerStats.activeItems) * 100 || 0;

        this.sellerStats.sellerPaysReturnsPercentage =
            (sellerPaysReturnPostageCount / acceptReturnsCount) * 100 || 0;
    }

    async getItemDescriptionLength(itemPage: Page): Promise<number> {
        const iframe = await itemPage.$("#desc_ifr"); // ds_div cannot be loaded outside iframe, so we must fetch the iframe content
        const contentFrame = await iframe?.contentFrame();
        const descriptionEl = await contentFrame?.$("#ds_div");

        const descriptionLength = (await descriptionEl?.evaluate((el) => el.textContent?.length)) as number;

        return descriptionLength;
    }

    async getItemImageCount(itemPage: Page): Promise<number> {
        const imageButtons = await itemPage.$$(".ux-image-filmstrip-carousel-item.image-treatment.image");

        return imageButtons?.length as number;
    }

    async getPostageDetails(itemPage: Page): Promise<PostageDetails> {
        const postagePrice = await itemPage.$(
            ".ux-labels-values.col-12.ux-labels-values--shipping span.ux-textspans.ux-textspans--BOLD"
        );

        let postageDetails: PostageDetails = {
            allowsPostage: false,
            isFree: false,
        };

        if (postagePrice === null) return postageDetails;
        postageDetails.allowsPostage = true;

        const priceText = await postagePrice.evaluate((el) => el.textContent);
        if (priceText?.startsWith("Free")) postageDetails.isFree = true;

        return postageDetails;
    }

    async getReturnDetails(itemPage: Page): Promise<ReturnDetails> {
        const returnInfoDiv = await itemPage.$(
            ".ux-labels-values.col-12.ux-labels-values__column-last-row.ux-labels-values--returns div.ux-labels-values__values-content div"
        );
        const returnInfo = await returnInfoDiv?.evaluate((el) => el.textContent);

        let returnDetails: ReturnDetails = {
            returnAllowed: false,
            sellerPays: false,
        };

        if (returnInfo?.startsWith("No")) return returnDetails;

        const sellerPays = returnInfo?.split(".")[1].trim().startsWith("Seller");

        returnDetails.returnAllowed = true;
        returnDetails.sellerPays = sellerPays || false;

        return returnDetails;
    }

    async browseSellerFeedback() {
        const feedbackPage = (await this.browser?.newPage()) as Page;
        await feedbackPage.goto(
            `https://www.ebay.co.uk/fdbk/feedback_profile/${this.username}?filter=feedback_page%3ARECEIVED_AS_SELLER`,
            { waitUntil: "load" }
        );

        const maximumFeedbackCountBtns = await feedbackPage?.$$(".itemsPerPage button");

        if (maximumFeedbackCountBtns && maximumFeedbackCountBtns.length > 0) {
            const surveryBtn = await feedbackPage.$("#seekSurvey");
            await surveryBtn?.evaluate((el) => el.remove()); // Remove it as it's in the way of the filters button

            // Press largest filter option
            await maximumFeedbackCountBtns[maximumFeedbackCountBtns.length - 1].click();
        }

        this.sellerStats.feedbackCount = await this.getFeedbackCount(feedbackPage);
        this.sellerStats.positiveFeedbackPercentage = await this.getPositiveFeedbackPercentage(feedbackPage);
        this.sellerStats.duplicateFeedbackPercentage = await this.findDuplicateFeedbackPercentage(
            feedbackPage
        );
    }

    async getFeedbackCount(feedbackPage: Page): Promise<number> {
        const feedbackCountEl = await feedbackPage.$(".userTopLine p");
        return Number(await feedbackCountEl?.evaluate((el) => el.textContent));
    }

    async getPositiveFeedbackPercentage(feedbackPage: Page): Promise<number> {
        const feedbackPercentageDetailsEl = await feedbackPage.$(".positiveFeedbackText>span");
        const feedbackPercentageDetails = await feedbackPercentageDetailsEl?.evaluate((el) => el.textContent);

        const words = feedbackPercentageDetails?.split(" ") as string[];
        return Number(words[words?.length - 1].slice(0, -1));
    }

    async findDuplicateFeedbackPercentage(feedbackPage: Page): Promise<number> {
        // TODO: Might want to filter only positive feedback in future for better results
        const feedbackContainers = (await feedbackPage?.$$(
            "#feedback-cards tr"
        )) as ElementHandle<HTMLTableRowElement>[];

        feedbackContainers.shift();

        // Key: Comment
        // Value: Array of users that said that comment
        const feedbackComments: Map<string, string[]> = new Map();
        let duplicateFeedbackCount = 0;

        const tasks = feedbackContainers.map(async (fbContainer) => {
            const commentEl = await fbContainer.$(".card__comment");
            const comment = (await commentEl?.evaluate((el) => el.textContent?.trim())) as string;

            if (!comment) return;

            if (comment.length < 15) return; // Don't count any duplicates if under this length

            const usernameEl = await fbContainer.$(".card__from>span[data-test-id]");
            const username = (await usernameEl?.evaluate((el) => el.textContent)) as string;

            const storedComment = feedbackComments.get(comment);

            if (!storedComment) {
                feedbackComments.set(comment, [username]);
                return;
            }

            if (storedComment.includes(username)) return;

            storedComment.push(username);
            feedbackComments.set(comment, storedComment);

            if (storedComment.length > 1) duplicateFeedbackCount++;
        }) as Promise<void>[];

        await Promise.all(tasks);

        return (duplicateFeedbackCount / feedbackContainers.length) * 100;
    }
}
