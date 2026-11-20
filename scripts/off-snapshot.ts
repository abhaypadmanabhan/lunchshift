// Refresh the committed demo data with npx tsx scripts/off-snapshot.ts.
// Discover trace-labelled U.S. breads with --find-peanut-bread before changing the curated list.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { OffCatalogProduct } from "../src/lib/domain/catalog.off";

const world = "https://world.openfoodfacts.org";
const userAgent = "LunchShiftHackathon/0.1 (demo)";
const fields = [
  "code", "product_name", "brands", "ingredients_text_en", "ingredients_text",
  "allergens_tags", "traces_tags", "image_front_small_url", "quantity", "countries_tags",
].join(",");
const root = resolve(import.meta.dirname, "..");
const imageDirectory = resolve(root, "public/products");
const snapshotFile = resolve(root, "src/lib/domain/catalog.off.json");

const selection: readonly {
  role: string;
  unit: string;
  products: readonly [barcode: string, demoPriceCents: number, packQty: number, estimate: string][];
}[] = [
  // Per role, the first product is the usual selection. Prices and pack quantities are demo inputs.
  {
    role: "bread", unit: "slice", products: [
      ["0793617000982", 449, 20, "Estimated 20 sandwich slices from the 680 g loaf."],
      ["0070733778965", 299, 20, "Estimated 20 sandwich slices from the 650 g loaf."],
      ["0041268765133", 349, 16, "Estimated 16 sandwich slices for one loaf. OFF has no ingredients text."],
    ],
  },
  {
    role: "seed_butter", unit: "tbsp", products: [
      ["0737539190017", 499, 28, "A 16 oz jar divided into approximately 16 g tablespoons."],
      ["0737539191205", 499, 28, "A 16 oz jar divided into approximately 16 g tablespoons."],
      ["0737539193582", 549, 28, "A 16 oz jar divided into approximately 16 g tablespoons."],
    ],
  },
  {
    role: "apple", unit: "each", products: [
      ["01480738", 119, 1, "One 3.9 oz single-serve applesauce cup."],
      ["0014800210781", 119, 1, "One 113 g single-serve applesauce cup."],
    ],
  },
  {
    role: "tortilla", unit: "each", products: [
      ["0046000273419", 229, 10, "Ten tortillas per retail package."],
      ["0073731170007", 399, 8, "Estimated eight tortillas for the 297 g package."],
      ["0073731071083", 259, 8, "Estimated eight medium tortillas for the retail pack."],
    ],
  },
  {
    role: "cheddar", unit: "portion", products: [
      ["0021000051915", 379, 10, "Estimated ten individually wrapped sticks, one stick per portion."],
      ["0046100017111", 379, 12, "Estimated 12 individually wrapped sticks, one stick per portion."],
      ["0046100007457", 619, 16, "One 1 oz portion of cheddar cubes from the 16 oz snack bag."],
    ],
  },
  {
    role: "grapes", unit: "portion", products: [
      ["0840437102232", 349, 8, "About eight 4 oz grape portions from a 2 lb bag."],
      ["0895321002259", 599, 12, "About twelve 4 oz grape portions from a 3 lb bag."],
    ],
  },
  {
    role: "pasta", unit: "portion", products: [
      ["0070253469602", 139, 8, "Eight 2 oz dry pasta portions from the 16 oz package."],
      ["0850014286071", 279, 6, "Six 2 oz dry pasta portions from the 12 oz package."],
      ["0078742209999", 119, 8, "Eight 2 oz dry pasta portions from the 16 oz package."],
    ],
  },
  {
    role: "tomato", unit: "portion", products: [
      ["0011110815330", 109, 3, "Estimated three 4 oz portions from a 14.5 oz can with juice."],
      ["0193968031213", 119, 3, "Estimated three 4 oz portions from a 411 g can with juice."],
      ["0041220210343", 279, 3, "Three 4 oz portions from the 12 oz package."],
    ],
  },
  {
    role: "pita", unit: "each", products: [
      ["0085239037874", 269, 12, "Estimated 12 mini pitas at 1 oz each from a 12 oz pack."],
      ["0074117882033", 279, 8, "Estimated eight mini pitas per retail bag."],
      ["0071628121040", 299, 8, "Estimated eight mini pitas per retail bag."],
    ],
  },
  {
    role: "hummus", unit: "portion", products: [
      ["0040822011143", 279, 5, "Five 2 oz lunch portions from the 284 g tub."],
      ["4099100051506", 249, 5, "Five 2 oz lunch portions from the 10 oz tub."],
      ["00764728", 349, 5, "Five 2 oz lunch portions from the 10 oz tub."],
    ],
  },
  {
    role: "carrot", unit: "portion", products: [
      ["0681131091329", 179, 4, "Estimated four 4 oz lunch portions from a 1 lb retail bag."],
      ["0011110182265", 399, 8, "Eight 4 oz lunch portions from the 32 oz bag."],
    ],
  },
  {
    role: "turkey", unit: "portion", products: [
      ["0078742162058", 379, 8, "Eight 2 oz portions from the 16 oz package."],
      ["0044500976519", 449, 4, "Four 2 oz deli-meat portions from the 9 oz package."],
    ],
  },
  {
    role: "rice", unit: "portion", products: [
      ["0017400140311", 239, 2, "Two microwave cups, one cup per lunch portion."],
      ["0017400140403", 239, 2, "Two microwave basmati rice cups, one cup per lunch portion."],
      ["0054800423392", 229, 2, "Estimated two lunch portions from one ready-rice pouch."],
    ],
  },
  {
    role: "black_beans", unit: "portion", products: [
      ["0039400018834", 149, 3, "Estimated three half-cup portions per 15 oz can, drained."],
      ["0072273487253", 179, 3, "Estimated three half-cup portions per 15 oz can, drained."],
    ],
  },
  {
    role: "corn", unit: "portion", products: [
      ["4099100109290", 99, 3, "Estimated three half-cup portions per 432 g can, drained."],
      ["0070552602298", 99, 3, "Estimated three half-cup portions per 432 g can, drained."],
    ],
  },
  {
    role: "gf_bread", unit: "slice", products: [
      ["0810757011514", 649, 12, "Estimated 12 sandwich slices in the 13.6 oz loaf."],
      ["0671521400206", 699, 14, "Estimated 14 sandwich slices in the 482 g loaf."],
    ],
  },
  {
    role: "rice_noodles", unit: "portion", products: [
      ["0737628025251", 369, 7, "About seven 2 oz dry portions from the 396 g box."],
      ["0070650800824", 369, 8, "Eight 2 oz dry portions from the 16 oz package."],
    ],
  },
  {
    role: "peanut_sauce", unit: "portion", products: [
      ["8850643026217", 369, 6, "Estimated six 2 tbsp sauce portions from the 200 g jar."],
      ["00772471", 379, 8, "Estimated eight 2 tbsp portions in a small retail bottle."],
    ],
  },
];

const barcodePattern = /^\d{4,14}$/;
const offProduct = z.object({
  code: z.string().regex(barcodePattern),
  product_name: z.string().trim().min(1),
  brands: z.string().trim().min(1),
  ingredients_text_en: z.string().nullish(),
  ingredients_text: z.string().nullish(),
  allergens_tags: z.array(z.string()).nullish(),
  traces_tags: z.array(z.string()).nullish(),
  image_front_small_url: z.string().nullish(),
  quantity: z.string().nullish(),
  countries_tags: z.array(z.string()),
});
const offSearchResult = z.object({ code: z.string(), product_name: z.string().optional() });

const spacing = { search: 6100, product: 2000, image: 0 };
const lastRequest = { search: 0, product: 0, image: 0 };

async function request<T>(
  url: URL,
  read: (response: Response) => Promise<T>,
  kind: keyof typeof spacing,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await delay(Math.max(0, lastRequest[kind] + spacing[kind] - Date.now()));
    lastRequest[kind] = Date.now();
    let retryDelay = kind === "search" ? 0 : 1000;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const after = Number(response.headers.get("Retry-After"));
          retryDelay = after > 0 ? after * 1000 : 30_000;
        }
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return await read(response);
    } catch (error) {
      if (attempt === 1) throw new Error(`${url}: ${String(error)}`, { cause: error });
      await delay(retryDelay);
    }
  }
}

async function findPeanutBread() {
  const url = new URL("/api/v2/search", world);
  url.search = new URLSearchParams({
    categories_tags: "en:breads",
    countries_tags: "en:united-states",
    traces_tags: "en:peanuts",
    fields,
    page_size: "40",
  }).toString();
  try {
    return await request(url, async (response) =>
      z.object({ products: z.array(offSearchResult) }).parse(await response.json()).products,
    "search");
  } catch (error) {
    console.warn(`OFF v2 search failed. Trying OFF's alternate search service. ${String(error)}`);
    const alternate = new URL("https://search.openfoodfacts.org/search");
    alternate.search = new URLSearchParams({
      q: 'categories_tags:"en:breads" AND countries_tags:"en:united-states" AND traces_tags:"en:peanuts"',
      fields,
      page_size: "40",
    }).toString();
    return request(alternate, async (response) =>
      z.object({ hits: z.array(offSearchResult) }).parse(await response.json()).hits,
    "search");
  }
}

async function downloadImage(barcode: string, imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) {
    console.warn(`${barcode}: OFF has no front image`);
    return null;
  }
  try {
    const url = new URL(imageUrl);
    if (url.origin !== "https://images.openfoodfacts.org") throw new Error("Unexpected image host");
    const jpeg = await request(url, async (response) => {
      const data = Buffer.from(await response.arrayBuffer());
      if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error("Expected a JPEG");
      return data;
    }, "image");
    const imageFile = `${barcode}.jpg`;
    await writeFile(resolve(imageDirectory, imageFile), jpeg);
    return imageFile;
  } catch (error) {
    console.warn(`${barcode}: image unavailable. ${String(error)}`);
    return null;
  }
}

async function capture() {
  const catalog: OffCatalogProduct[] = [];
  await mkdir(imageDirectory, { recursive: true });
  for (const { role, unit, products } of selection) {
    for (const [barcode, demoPriceCents, packQty, comment] of products) {
      const url = new URL(`/api/v2/product/${barcode}.json`, world);
      url.searchParams.set("fields", fields);
      const product = await request(url, async (response) =>
        z.object({ product: offProduct }).parse(await response.json()).product, "product");
      if (product.code !== barcode || !product.countries_tags.includes("en:united-states")) {
        throw new Error(`${barcode}: expected this exact barcode in the US catalog`);
      }
      catalog.push({
        barcode,
        name: product.product_name,
        brand: product.brands,
        role,
        ingredientsText: product.ingredients_text_en?.trim() || product.ingredients_text?.trim() || "",
        allergenTags: product.allergens_tags ?? [],
        traceTags: product.traces_tags ?? [],
        imageFile: await downloadImage(barcode, product.image_front_small_url),
        sourceUrl: `${world}/product/${barcode}`,
        quantity: product.quantity ?? "",
        demoPriceCents,
        packQty,
        unit,
        comment,
      });
      console.log(`${role}: ${barcode} ${product.product_name}`);
    }
  }
  const pending = `${snapshotFile}.${process.pid}.tmp`;
  await writeFile(pending, `${JSON.stringify(catalog, null, 2)}\n`);
  await rename(pending, snapshotFile);
  console.log(`Captured ${catalog.length} products.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) await capture();
  else if (args.length === 1 && args[0] === "--find-peanut-bread") console.table(await findPeanutBread());
  else throw new Error("Usage: off-snapshot.ts [--find-peanut-bread]");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
