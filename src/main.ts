import { RobotsTxtFile } from "crawlee";

const BASE_URL = "https://www.structube.com";

const robots = await RobotsTxtFile.find(BASE_URL);
const urls = await robots.parseUrlsFromSitemaps();

const categories = [
  ...new Set(
    urls.filter((url) => {
      const parsed = new URL(url);

      return (
        parsed.hostname === "www.structube.com" &&
        parsed.pathname.startsWith("/en_ca/furniture/") &&
        !parsed.search
      );
    }),
  ),
];

console.log(`Found ${categories.length} category URLs`);
console.log(categories);
