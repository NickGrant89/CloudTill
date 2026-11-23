import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_SLUGS = ["demo-cafe", "downtown"];

/** Keep the hosted demo UK-shaped without touching any customer store. */
async function ukifyDemo() {
  await prisma.store.updateMany({
    where: { slug: "demo-cafe" },
    data: { address: "100 Market Street, Manchester M1 1AA", phone: "0161 555 0100", timezone: "Europe/London" },
  });
  await prisma.store.updateMany({
    where: { slug: "downtown" },
    data: { address: "22 Harbour Road, Salford M50 2AB", timezone: "Europe/London" },
  });
  const demoStores = await prisma.store.findMany({ where: { slug: { in: DEMO_SLUGS } }, select: { id: true } });
  await prisma.tax.updateMany({
    where: { storeId: { in: demoStores.map((s) => s.id) }, name: "Sales Tax" },
    data: { name: "VAT", rateBps: 2000, inclusive: true },
  });
}

async function main() {
  // Runs on every container start. Never wipe real companies: only reseed from scratch when forced.
  if (process.env.SEED_FORCE !== "1") {
    const existing = await prisma.store.findMany({ where: { slug: { in: DEMO_SLUGS } }, select: { slug: true } });
    if (existing.length > 0) {
      await ukifyDemo();
      console.log("Demo store present — seed skipped (set SEED_FORCE=1 to wipe and reseed).");
      return;
    }
    const otherStores = await prisma.store.count();
    if (otherStores > 0) {
      console.log(`Creating demo store alongside ${otherStores} existing store(s) — nothing deleted.`);
    }
  } else {
    await wipeAll();
  }
  await seedDemo();
}

async function wipeAll() {
  await prisma.printJob.deleteMany();
  await prisma.printerDevice.deleteMany();
  await prisma.onlineOrderLine.deleteMany();
  await prisma.onlineOrder.deleteMany();
  await prisma.salePayment.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.ticketLine.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.cashEvent.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.giftCardLedger.deleteMany();
  await prisma.giftCard.deleteMany();
  await prisma.timeClockEntry.deleteMany();
  await prisma.inventoryTransfer.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventoryLevel.deleteMany();
  await prisma.kitComponent.deleteMany();
  await prisma.modifier.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.variant.deleteMany();
  await prisma.item.deleteMany();
  await prisma.category.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.tax.deleteMany();
  await prisma.paymentType.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.register.deleteMany();
  await prisma.store.deleteMany();
}

async function seedDemo() {
  const store = await prisma.store.create({
    data: {
      slug: "demo-cafe",
      name: "PurePOS Demo Café",
      address: "100 Market Street, Manchester M1 1AA",
      phone: "0161 555 0100",
      currency: "GBP",
      timezone: "Europe/London",
      companyKey: "demo",
    },
  });

  const store2 = await prisma.store.create({
    data: {
      slug: "downtown",
      name: "PurePOS Downtown (stub)",
      address: "22 Harbour Road, Salford M50 2AB",
      currency: "GBP",
      timezone: "Europe/London",
      companyKey: "demo",
    },
  });

  const reg1 = await prisma.register.create({
    data: { storeId: store.id, name: "Front Counter" },
  });
  await prisma.register.create({
    data: { storeId: store.id, name: "Patio Kiosk" },
  });
  await prisma.register.create({
    data: { storeId: store2.id, name: "Main" },
  });

  const pin = async (p: string) => bcrypt.hash(p, 8);

  const owner = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Alex Owner",
      email: "owner@purepos.demo",
      pinHash: await pin("1234"),
      pinDisplay: "1234",
      role: "owner",
    },
  });
  const manager = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Morgan Manager",
      email: "manager@purepos.demo",
      pinHash: await pin("2222"),
      pinDisplay: "2222",
      role: "manager",
    },
  });
  const cashier = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Casey Cashier",
      email: "cashier@purepos.demo",
      pinHash: await pin("1111"),
      pinDisplay: "1111",
      role: "cashier",
    },
  });

  const cats = await Promise.all(
    [
      { name: "Coffee", color: "#5C4033", sortOrder: 0 },
      { name: "Tea", color: "#2F6F4E", sortOrder: 1 },
      { name: "Pastries", color: "#C4783A", sortOrder: 2 },
      { name: "Sandwiches", color: "#3D5A80", sortOrder: 3 },
      { name: "Retail", color: "#6B5B4F", sortOrder: 4 },
    ].map((c) =>
      prisma.category.create({ data: { ...c, storeId: store.id } })
    )
  );

  const [coffee, tea, pastries, sandwiches, retail] = cats;

  async function createItem(opts: {
    name: string;
    categoryId: string;
    color: string;
    priceCents: number;
    costCents?: number;
    sku: string;
    barcode?: string;
    trackStock?: boolean;
    stock?: number;
    modifiers?: { group: string; min?: number; max?: number; options: { name: string; priceCents: number }[] }[];
    isComposite?: boolean;
    kit?: { sku: string; qty: number }[];
  }) {
    const item = await prisma.item.create({
      data: {
        storeId: store.id,
        categoryId: opts.categoryId,
        name: opts.name,
        color: opts.color,
        isComposite: opts.isComposite ?? false,
        variants: {
          create: {
            name: "Regular",
            sku: opts.sku,
            barcode: opts.barcode,
            priceCents: opts.priceCents,
            costCents: opts.costCents ?? Math.round(opts.priceCents * 0.35),
            trackStock: opts.trackStock ?? true,
          },
        },
      },
      include: { variants: true },
    });
    const variant = item.variants[0];
    await prisma.inventoryLevel.create({
      data: {
        storeId: store.id,
        variantId: variant.id,
        quantity: opts.stock ?? 50,
        lowStock: 8,
      },
    });
    // stub second store stock
    await prisma.inventoryLevel.create({
      data: {
        storeId: store2.id,
        variantId: variant.id,
        quantity: Math.floor((opts.stock ?? 50) / 3),
        lowStock: 5,
      },
    });

    if (opts.modifiers) {
      for (const [index, g] of opts.modifiers.entries()) {
        await prisma.modifierGroup.create({
          data: {
            itemId: item.id,
            name: g.group,
            minSelect: g.min ?? 0,
            maxSelect: g.max ?? 1,
            sortOrder: index,
            modifiers: {
              create: g.options.map((o, optionIndex) => ({
                name: o.name,
                priceCents: o.priceCents,
                sortOrder: optionIndex,
              })),
            },
          },
        });
      }
    }
    return { item, variant };
  }

  const latte = await createItem({
    name: "Latte",
    categoryId: coffee.id,
    color: "#8B5E3C",
    priceCents: 450,
    sku: "COF-LATTE",
    barcode: "1001001001",
    modifiers: [
      {
        group: "Size",
        min: 1,
        max: 1,
        options: [
          { name: "Small", priceCents: 0 },
          { name: "Medium", priceCents: 50 },
          { name: "Large", priceCents: 100 },
        ],
      },
      {
        group: "Milk",
        options: [
          { name: "Whole", priceCents: 0 },
          { name: "Oat", priceCents: 75 },
          { name: "Almond", priceCents: 75 },
        ],
      },
    ],
  });

  await createItem({
    name: "Americano",
    categoryId: coffee.id,
    color: "#4A3728",
    priceCents: 350,
    sku: "COF-AMER",
    barcode: "1001001002",
  });
  await createItem({
    name: "Cappuccino",
    categoryId: coffee.id,
    color: "#6B4423",
    priceCents: 425,
    sku: "COF-CAP",
    barcode: "1001001003",
  });
  await createItem({
    name: "Cold Brew",
    categoryId: coffee.id,
    color: "#3E2723",
    priceCents: 475,
    sku: "COF-COLD",
    barcode: "1001001004",
  });
  await createItem({
    name: "Espresso",
    categoryId: coffee.id,
    color: "#2C1810",
    priceCents: 275,
    sku: "COF-ESP",
    barcode: "1001001005",
  });

  await createItem({
    name: "Green Tea",
    categoryId: tea.id,
    color: "#3A7D44",
    priceCents: 300,
    sku: "TEA-GRN",
    barcode: "2002002001",
  });
  await createItem({
    name: "Chai Latte",
    categoryId: tea.id,
    color: "#B86B2A",
    priceCents: 425,
    sku: "TEA-CHAI",
    barcode: "2002002002",
  });

  const croissant = await createItem({
    name: "Butter Croissant",
    categoryId: pastries.id,
    color: "#D4A574",
    priceCents: 325,
    sku: "PAS-CRO",
    barcode: "3003003001",
    stock: 24,
  });
  await createItem({
    name: "Blueberry Muffin",
    categoryId: pastries.id,
    color: "#5B6AA8",
    priceCents: 350,
    sku: "PAS-MUF",
    barcode: "3003003002",
    stock: 4, // below lowStock (8) — drives BO low-stock toast
  });
  await createItem({
    name: "Chocolate Cookie",
    categoryId: pastries.id,
    color: "#5D4037",
    priceCents: 250,
    sku: "PAS-CKI",
    barcode: "3003003003",
    stock: 40,
  });

  await createItem({
    name: "Turkey Club",
    categoryId: sandwiches.id,
    color: "#4A6741",
    priceCents: 895,
    sku: "SND-TUR",
    barcode: "4004004001",
    stock: 12,
  });
  await createItem({
    name: "Caprese Panini",
    categoryId: sandwiches.id,
    color: "#C45C26",
    priceCents: 850,
    sku: "SND-CAP",
    barcode: "4004004002",
    stock: 10,
  });

  await createItem({
    name: "Travel Mug",
    categoryId: retail.id,
    color: "#455A64",
    priceCents: 1895,
    sku: "RET-MUG",
    barcode: "5005005001",
    stock: 15,
  });
  await createItem({
    name: "Bag of Beans 12oz",
    categoryId: retail.id,
    color: "#6D4C41",
    priceCents: 1495,
    sku: "RET-BEAN",
    barcode: "5005005002",
    stock: 20,
  });

  // Kit: Breakfast combo = latte + croissant
  const combo = await prisma.item.create({
    data: {
      storeId: store.id,
      categoryId: pastries.id,
      name: "Breakfast Combo",
      color: "#8D6E63",
      isComposite: true,
      variants: {
        create: {
          name: "Regular",
          sku: "KIT-BFST",
          barcode: "9009009001",
          priceCents: 699,
          costCents: 300,
          trackStock: false,
        },
      },
    },
    include: { variants: true },
  });
  await prisma.kitComponent.createMany({
    data: [
      { parentItemId: combo.id, componentVarId: latte.variant.id, quantity: 1 },
      { parentItemId: combo.id, componentVarId: croissant.variant.id, quantity: 1 },
    ],
  });
  await prisma.inventoryLevel.create({
    data: { storeId: store.id, variantId: combo.variants[0].id, quantity: 0, lowStock: 0 },
  });

  await prisma.tax.createMany({
    data: [
      { storeId: store.id, name: "VAT", rateBps: 2000, inclusive: true, enabled: true },
      { storeId: store2.id, name: "VAT", rateBps: 2000, inclusive: true, enabled: true },
    ],
  });

  await prisma.paymentType.createMany({
    data: [
      { storeId: store.id, name: "Cash", type: "cash", opensDrawer: true },
      { storeId: store.id, name: "Card", type: "card", opensDrawer: false },
      { storeId: store.id, name: "Other", type: "other", opensDrawer: false },
      { storeId: store.id, name: "Store Credit", type: "store_credit", opensDrawer: false },
      { storeId: store.id, name: "Gift Card", type: "gift_card", opensDrawer: false },
      { storeId: store2.id, name: "Cash", type: "cash", opensDrawer: true },
      { storeId: store2.id, name: "Card", type: "card", opensDrawer: false },
      { storeId: store2.id, name: "Gift Card", type: "gift_card", opensDrawer: false },
    ],
  });

  // Favorites seeded after items exist — placeholder ids filled below
  await prisma.setting.createMany({
    data: [
      { storeId: store.id, key: "receipt.header", value: "PurePOS Demo Café" },
      { storeId: store.id, key: "receipt.footer", value: "Thank you! purepos.co.uk" },
      { storeId: store.id, key: "receipt.showTaxBreakdown", value: "true" },
      { storeId: store.id, key: "tips.presets", value: JSON.stringify([10, 15, 18, 20]) },
      { storeId: store.id, key: "loyalty.pointsPerDollar", value: "1" },
    ],
  });

  const customers = await Promise.all(
    [
      { name: "Jamie Patron", email: "jamie@example.com", phone: "555-1001", loyaltyPoints: 120, storeCreditCents: 500 },
      { name: "Riley Regular", email: "riley@example.com", phone: "555-1002", loyaltyPoints: 45, storeCreditCents: 0 },
      { name: "Sam Visitor", phone: "555-1003", loyaltyPoints: 0, storeCreditCents: 1000 },
    ].map((c) =>
      prisma.customer.create({
        data: { ...c, storeId: store.id, visitCount: c.loyaltyPoints > 0 ? 8 : 1, totalSpentCents: c.loyaltyPoints * 100 },
      })
    )
  );

  // Open shift for demo
  await prisma.shift.create({
    data: {
      storeId: store.id,
      registerId: reg1.id,
      employeeId: cashier.id,
      openingFloatCents: 15000,
      status: "open",
    },
  });

  // Sample completed sale for history/reports
  const paymentTypes = await prisma.paymentType.findMany({ where: { storeId: store.id } });
  const cashPt = paymentTypes.find((p) => p.type === "cash")!;
  const cardPt = paymentTypes.find((p) => p.type === "card")!;

  const sampleSale = await prisma.sale.create({
    data: {
      receiptNumber: "CT-10001",
      storeId: store.id,
      registerId: reg1.id,
      employeeId: cashier.id,
      customerId: customers[0].id,
      status: "completed",
      subtotalCents: 450,
      discountCents: 0,
      taxCents: 37,
      tipCents: 100,
      totalCents: 587,
      paidCents: 587,
      changeCents: 0,
      lines: {
        create: [
          {
            variantId: latte.variant.id,
            name: "Latte",
            quantity: 1,
            unitPriceCents: 450,
            taxCents: 37,
            totalCents: 450,
            modifiersJson: JSON.stringify([{ name: "Medium", priceCents: 50 }]),
          },
        ],
      },
      payments: {
        create: [
          {
            paymentTypeId: cardPt.id,
            paymentTypeName: "Card",
            amountCents: 587,
          },
        ],
      },
    },
  });

  await prisma.sale.create({
    data: {
      receiptNumber: "CT-10002",
      storeId: store.id,
      registerId: reg1.id,
      employeeId: manager.id,
      status: "completed",
      subtotalCents: 1220,
      discountCents: 100,
      taxCents: 92,
      tipCents: 0,
      totalCents: 1212,
      paidCents: 1500,
      changeCents: 288,
      lines: {
        create: [
          {
            variantId: croissant.variant.id,
            name: "Butter Croissant",
            quantity: 2,
            unitPriceCents: 325,
            discountCents: 50,
            taxCents: 49,
            totalCents: 600,
          },
          {
            name: "Turkey Club",
            quantity: 1,
            unitPriceCents: 895,
            discountCents: 50,
            taxCents: 43,
            totalCents: 845,
          },
        ],
      },
      payments: {
        create: [
          {
            paymentTypeId: cashPt.id,
            paymentTypeName: "Cash",
            amountCents: 1212,
            tenderedCents: 1500,
          },
        ],
      },
    },
  });

  await prisma.inventoryMovement.createMany({
    data: [
      {
        storeId: store.id,
        variantId: latte.variant.id,
        type: "receive",
        quantity: 50,
        note: "Initial stock",
        employeeId: owner.id,
      },
      {
        storeId: store.id,
        variantId: latte.variant.id,
        type: "sale",
        quantity: -1,
        note: `Sale ${sampleSale.receiptNumber}`,
        employeeId: cashier.id,
      },
    ],
  });

  // Store-to-store transfer (croissant → downtown)
  const fromLevel = await prisma.inventoryLevel.findUniqueOrThrow({
    where: { storeId_variantId: { storeId: store.id, variantId: croissant.variant.id } },
  });
  await prisma.inventoryLevel.update({
    where: { id: fromLevel.id },
    data: { quantity: fromLevel.quantity - 5 },
  });
  const toCroissant = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId: store2.id, variantId: croissant.variant.id } },
  });
  if (toCroissant) {
    await prisma.inventoryLevel.update({
      where: { id: toCroissant.id },
      data: { quantity: toCroissant.quantity + 5 },
    });
  }
  await prisma.inventoryTransfer.create({
    data: {
      fromStoreId: store.id,
      toStoreId: store2.id,
      variantId: croissant.variant.id,
      quantity: 5,
      status: "completed",
      note: "Restock downtown pastry case",
      employeeId: manager.id,
    },
  });
  await prisma.inventoryMovement.createMany({
    data: [
      {
        storeId: store.id,
        variantId: croissant.variant.id,
        type: "transfer",
        quantity: -5,
        note: "Transfer to downtown",
        employeeId: manager.id,
      },
      {
        storeId: store2.id,
        variantId: croissant.variant.id,
        type: "transfer",
        quantity: 5,
        note: "Transfer from café",
        employeeId: manager.id,
      },
    ],
  });

  await prisma.giftCard.create({
    data: {
      storeId: store.id,
      code: "GC-DEMO50",
      initialCents: 5000,
      balanceCents: 5000,
      customerId: customers[0].id,
      status: "active",
      ledger: {
        create: {
          type: "issue",
          amountCents: 5000,
          balanceAfter: 5000,
          note: "Welcome gift card",
          employeeId: owner.id,
        },
      },
    },
  });
  await prisma.giftCard.create({
    data: {
      storeId: store.id,
      code: "GC-PARTIAL",
      initialCents: 2500,
      balanceCents: 1800,
      status: "active",
      ledger: {
        create: [
          {
            type: "issue",
            amountCents: 2500,
            balanceAfter: 2500,
            note: "Issued",
            employeeId: manager.id,
          },
          {
            type: "redeem",
            amountCents: -700,
            balanceAfter: 1800,
            note: "Prior redeem",
            employeeId: cashier.id,
          },
        ],
      },
    },
  });

  // Time clock: cashier currently clocked in; manager closed yesterday shift
  await prisma.timeClockEntry.create({
    data: {
      storeId: store.id,
      employeeId: cashier.id,
      clockIn: new Date(Date.now() - 3 * 3600000),
      note: "Front counter",
    },
  });
  await prisma.timeClockEntry.create({
    data: {
      storeId: store.id,
      employeeId: manager.id,
      clockIn: new Date(Date.now() - 26 * 3600000),
      clockOut: new Date(Date.now() - 18 * 3600000),
      note: "Open / close",
    },
  });

  await prisma.printerDevice.createMany({
    data: [
      {
        storeId: store.id,
        name: "Front Counter Mock",
        driver: "mock",
        isDefault: true,
        enabled: true,
      },
      {
        storeId: store.id,
        name: "Kitchen Network (demo)",
        driver: "network",
        host: "127.0.0.1",
        port: 9100,
        isDefault: false,
        enabled: true,
      },
    ],
  });

  // Sample online order → kitchen ticket
  const onlineTicket = await prisma.ticket.create({
    data: {
      storeId: store.id,
      registerId: reg1.id,
      name: "Online OL-1001",
      status: "held",
      source: "online",
      kitchenStatus: "queued",
      note: "pickup · Taylor Guest · 555-2001",
      lines: {
        create: [
          {
            variantId: latte.variant.id,
            name: "Latte",
            quantity: 1,
            unitPriceCents: 450,
            modifiersJson: JSON.stringify([{ name: "Oat", priceCents: 75 }]),
          },
        ],
      },
    },
  });
  await prisma.onlineOrder.create({
    data: {
      storeId: store.id,
      ticketId: onlineTicket.id,
      orderNumber: "OL-1001",
      customerName: "Taylor Guest",
      customerPhone: "555-2001",
      fulfillment: "pickup",
      status: "pending",
      note: "Extra hot",
      subtotalCents: 525,
      taxCents: 43,
      totalCents: 568,
      lines: {
        create: [
          {
            variantId: latte.variant.id,
            name: "Latte",
            quantity: 1,
            unitPriceCents: 450,
            modifiersJson: JSON.stringify([{ name: "Oat", priceCents: 75 }]),
          },
        ],
      },
    },
  });

  await prisma.setting.upsert({
    where: { storeId_key: { storeId: store.id, key: "pos.favorites" } },
    create: {
      storeId: store.id,
      key: "pos.favorites",
      value: JSON.stringify([latte.item.id, croissant.item.id, combo.id]),
    },
    update: {
      value: JSON.stringify([latte.item.id, croissant.item.id, combo.id]),
    },
  });

  await prisma.setting.createMany({
    data: [
      { storeId: store.id, key: "billing.plan", value: "pro" },
      { storeId: store.id, key: "billing.licensedPlan", value: "pro" },
      { storeId: store.id, key: "billing.status", value: "active" },
      { storeId: store.id, key: "billing.migrated.entitlements", value: "1" },
    ],
  });

  console.log("Seeded PurePOS demo:");
  console.log("  Store:", store.name, `(slug: ${store.slug})`);
  console.log("  owner@purepos.demo PIN 1234");
  console.log("  manager@purepos.demo PIN 2222");
  console.log("  cashier@purepos.demo PIN 1111");
  console.log("  Gift cards: GC-DEMO50 (£50), GC-PARTIAL (£18)");
  console.log("  Online order: OL-1001 (kitchen queue)");
  console.log("  Favorites: Latte, Croissant, Breakfast Combo");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
