import { Router } from "express";
import rateSeller from "../../sellerRater";
import SellerScraper from "../../scrapers/SellerScraper";

const router = Router();
router.post("/rate-seller", async (req, res) => {
    const { username } = req.body;

    const scraper = new SellerScraper(username);
    await scraper.scrapeSellerData();

    const sellerRating = rateSeller(scraper.sellerStats);
    (sellerRating as any[]).push(scraper.sellerStats);
    (sellerRating as any[]).push(username);

    res.status(200).json(sellerRating);
});

export default router;
