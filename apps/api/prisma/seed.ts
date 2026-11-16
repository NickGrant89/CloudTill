import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.salePayment.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.ticketLine.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.cashEvent.deleteMany();
  await prisma.shift.deleteMany();
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

  const store = await prisma.store.create({
    data: {
      name: "CloudTill Demo Café",
      address: "100 Market Street, Demo City",
      phone: "+1 555-0100",
      currency: "USD",
      timezone: "America/New_York",
    },
  });

  const store2 = await prisma.store.create({
    data: {
      name: "CloudTill Downtown (stub)",
      address: "22 Harbor Ave",
      currency: "USD",
      timezone: "America/New_York",
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
      email: "owner@cloudtill.demo",
      pinHash: await pin("1234"),
      pinDisplay: "1234",
      role: "owner",
    },
  });
  const manager = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Morgan Manager",
      email: "manager@cloudtill.demo",
      pinHash: await pin("2222"),
      pinDisplay: "2222",
      role: "manager",
    },
  });
  const cashier = await prisma.employee.create({
    data: {
      storeId: store.id,
      name: "Casey Cashier",
      email: "cashier@cloudtill.demo",
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
      for (const g of opts.modifiers) {
        await prisma.modifierGroup.create({
          data: {
            itemId: item.id,
            name: g.group,
            minSelect: g.min ?? 0,
            maxSelect: g.max ?? 1,
            modifiers: {
              create: g.options.map((o) => ({
                name: o.name,
                priceCents: o.priceCents,
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
    stock: 18,
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
      { storeId: store.id, name: "Sales Tax", rateBps: 825, inclusive: false, enabled: true },
      { storeId: store2.id, name: "Sales Tax", rateBps: 825, inclusive: false, enabled: true },
    ],
  });

  await prisma.paymentType.createMany({
    data: [
      { storeId: store.id, name: "Cash", type: "cash", opensDrawer: true },
      { storeId: store.id, name: "Card", type: "card", opensDrawer: false },
      { storeId: store.id, name: "Other", type: "other", opensDrawer: false },
      { storeId: store.id, name: "Store Credit", type: "store_credit", opensDrawer: false },
      { storeId: store2.id, name: "Cash", type: "cash", opensDrawer: true },
      { storeId: store2.id, name: "Card", type: "card", opensDrawer: false },
    ],
  });

  await prisma.setting.createMany({
    data: [
      { storeId: store.id, key: "receipt.header", value: "CloudTill Demo Café" },
      { storeId: store.id, key: "receipt.footer", value: "Thank you! cloudtill.demo" },
      { storeId: store.id, key: "receipt.showTaxBreakdown", value: "true" },
      { storeId: store.id, key: "tips.presets", value: JSON.stringify([10, 15, 20]) },
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

  console.log("Seeded CloudTill demo:");
  console.log("  Store:", store.name);
  console.log("  owner@cloudtill.demo PIN 1234");
  console.log("  manager@cloudtill.demo PIN 2222");
  console.log("  cashier@cloudtill.demo PIN 1111");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
