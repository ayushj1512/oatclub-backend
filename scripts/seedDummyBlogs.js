import "dotenv/config";
import mongoose from "mongoose";
import Blog from "../Blogs/Blogs.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env");
  process.exit(1);
}

const dummyImage =
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?q=80&w=1200&auto=format&fit=crop";

const blogs = [
  {
    slug: "how-to-style-co-ord-sets",
    title: "How To Style Co-Ord Sets For Everyday Luxury",
    excerpt:
      "A clean guide to styling co-ord sets with a refined, fashion-forward approach.",
    date: "2026-06-04",
    category: "Style Guide",
    tags: ["Co-Ord Sets", "Styling", "OATCLUB"],
    image: dummyImage,
    content: `
Co-ord sets are one of the easiest ways to look polished without overthinking the outfit. The beauty of a matching set lies in its simplicity — it feels styled, balanced, and effortless.

For daytime looks, choose breathable fabrics, soft tones, and minimal accessories. Pair your co-ord set with flat sandals, clean sneakers, or structured slides. Keep the bag compact and jewellery subtle.

For evening styling, switch to heels, add a sleek clutch, and layer delicate metallic jewellery. A fitted co-ord set can instantly become dinner-ready when paired with the right details.

At OATCLUB, co-ord sets are designed for women who want comfort without losing the premium edge. Style them together for a complete look or split them into separates for more outfit options.
    `,
    isPublished: true,
  },
  {
    slug: "black-and-white-fashion-essentials",
    title: "Black And White Fashion Essentials Every Wardrobe Needs",
    excerpt:
      "Timeless monochrome pieces that keep your wardrobe sharp, clean, and versatile.",
    date: "2026-06-04",
    category: "Wardrobe",
    tags: ["Minimal Fashion", "Black And White", "Essentials"],
    image: dummyImage,
    content: `
Black and white dressing never feels outdated. It is clean, confident, and easy to style across seasons. A strong monochrome wardrobe gives you more outfit combinations with fewer pieces.

Start with a fitted black top, a crisp white shirt, relaxed trousers, and one statement dress. These pieces can be styled for work, brunch, travel, or evening plans.

The key is balance. If the outfit is simple, use texture to create interest. Ribbed knits, cotton blends, satin finishes, and structured silhouettes make monochrome outfits feel premium.

OATCLUB keeps monochrome fashion modern with sharp cuts, wearable fits, and clean details.
    `,
    isPublished: true,
  },
  {
    slug: "summer-dresses-for-effortless-days",
    title: "Summer Dresses For Effortless Days",
    excerpt:
      "Lightweight dresses that bring comfort, movement, and easy elegance to warm days.",
    date: "2026-06-04",
    category: "Dresses",
    tags: ["Dresses", "Summer Fashion", "Resort Wear"],
    image: dummyImage,
    content: `
A good summer dress should feel light, flattering, and easy to wear. It should move with you and still look refined without heavy styling.

Choose soft fabrics, clean necklines, and silhouettes that allow comfort through the day. Mini dresses work well for casual outings, while midi dresses bring a more polished resort-inspired feel.

For styling, keep accessories minimal. A pair of sunglasses, flat sandals, and a compact shoulder bag are enough to complete the look.

OATCLUB summer dresses are made for women who prefer effortless dressing with a modern luxury mood.
    `,
    isPublished: true,
  },
  {
    slug: "how-to-build-a-premium-capsule-wardrobe",
    title: "How To Build A Premium Capsule Wardrobe",
    excerpt:
      "A simple guide to building a smaller, sharper, and more wearable wardrobe.",
    date: "2026-06-04",
    category: "Wardrobe",
    tags: ["Capsule Wardrobe", "Minimal Style", "Premium Basics"],
    image: dummyImage,
    content: `
A capsule wardrobe is not about owning less. It is about owning better. Every piece should work with multiple outfits and still feel fresh.

Begin with neutral basics: fitted tops, relaxed trousers, clean denim, versatile dresses, and structured outerwear. These items become the base of your daily style.

Focus on fit first. A simple piece looks premium when the fit is right. Avoid unnecessary details and choose silhouettes that feel modern.

With OATCLUB, capsule dressing becomes easier through refined pieces that can be mixed, layered, and repeated without looking basic.
    `,
    isPublished: true,
  },
  {
    slug: "from-brunch-to-evening-outfit-guide",
    title: "From Brunch To Evening: Outfit Guide",
    excerpt:
      "Easy outfit transitions that keep your look polished from day to night.",
    date: "2026-06-04",
    category: "Style Guide",
    tags: ["Day To Night", "Outfit Ideas", "Fashion Guide"],
    image: dummyImage,
    content: `
The best outfits are the ones that can move with your day. A brunch look should be comfortable, but with small changes, it can become evening-ready.

Start with a clean base such as a co-ord set, midi dress, or fitted top with trousers. For day styling, keep footwear relaxed and accessories light.

For evening, add heels, a sleek bag, and stronger jewellery. You can also layer with a blazer or cropped jacket for structure.

OATCLUB pieces are designed with this flexibility in mind — easy enough for the day, refined enough for the night.
    `,
    isPublished: true,
  },
  {
    slug: "the-rise-of-clean-girl-fashion",
    title: "The Rise Of Clean Girl Fashion",
    excerpt:
      "Why minimal silhouettes, fresh styling, and refined basics are defining modern wardrobes.",
    date: "2026-06-04",
    category: "Trends",
    tags: ["Clean Girl", "Trends", "Minimal Fashion"],
    image: dummyImage,
    content: `
Clean girl fashion is built around simplicity, polish, and effortlessness. It focuses on fresh silhouettes, neutral tones, smooth textures, and minimal styling.

The look works because it feels modern without being loud. A fitted top, straight trousers, soft knit, or minimal dress can create a sharp outfit when styled with intention.

Hair, accessories, and footwear play a major role. Sleek styling, small hoops, clean bags, and neutral footwear complete the aesthetic.

OATCLUB translates this trend into wearable pieces for everyday fashion with a premium touch.
    `,
    isPublished: true,
  },
  {
    slug: "vacation-outfits-that-look-expensive",
    title: "Vacation Outfits That Look Expensive",
    excerpt:
      "Resort-inspired styling ideas for travel looks that feel refined and effortless.",
    date: "2026-06-04",
    category: "Vacation",
    tags: ["Vacation Wear", "Resort Style", "Travel Fashion"],
    image: dummyImage,
    content: `
Vacation outfits should feel relaxed but still considered. The goal is to look effortless, not overdone.

Choose breathable co-ords, flowy dresses, soft shirts, and versatile bottoms. Neutral tones, linen-inspired textures, and clean cuts instantly make travel looks feel more premium.

Pack pieces that can be repeated in different ways. A shirt can work as a layer, a dress can move from beach to dinner, and a co-ord set can be styled together or separately.

OATCLUB vacation edits are built for movement, comfort, and a refined resort mood.
    `,
    isPublished: true,
  },
  {
    slug: "why-fit-matters-more-than-trends",
    title: "Why Fit Matters More Than Trends",
    excerpt:
      "A premium outfit starts with fit before color, trend, or styling.",
    date: "2026-06-04",
    category: "Fashion Advice",
    tags: ["Fit Guide", "Premium Fashion", "Styling Tips"],
    image: dummyImage,
    content: `
Trends change quickly, but fit always matters. A well-fitted outfit can look premium even when the design is simple.

The right fit improves posture, proportion, and confidence. It makes basic pieces feel intentional and polished.

When shopping, look at shoulder placement, waist shape, length, and overall comfort. A piece should flatter without restricting movement.

At OATCLUB, fit is a key part of the design mood — modern, wearable, and flattering for real wardrobes.
    `,
    isPublished: true,
  },
  {
    slug: "denim-styling-for-modern-women",
    title: "Denim Styling For Modern Women",
    excerpt:
      "Clean denim outfit ideas that feel current, elevated, and easy to repeat.",
    date: "2026-06-04",
    category: "Denim",
    tags: ["Denim", "Outfit Ideas", "Modern Fashion"],
    image: dummyImage,
    content: `
Denim is one of the strongest foundations in a modern wardrobe. It can be casual, sharp, relaxed, or statement depending on how it is styled.

Pair straight denim with a fitted black top for a clean everyday look. Add a white shirt for a more polished outfit. For evening, choose a structured top and sleek heels.

The secret is keeping the rest of the look refined. Avoid over-layering and let the denim shape the outfit.

OATCLUB denim styling is about easy confidence with a clean premium finish.
    `,
    isPublished: true,
  },
  {
    slug: "new-season-fashion-moodboard",
    title: "New Season Fashion Moodboard",
    excerpt:
      "A fresh direction for refined everyday dressing, clean silhouettes, and modern details.",
    date: "2026-06-04",
    category: "Trends",
    tags: ["New Season", "Fashion Moodboard", "OATCLUB"],
    image: dummyImage,
    content: `
The new season is moving toward clean silhouettes, soft structure, neutral palettes, and pieces that feel easy but styled.

Expect co-ord sets, minimal dresses, elevated basics, and relaxed tailoring to lead the wardrobe. The mood is less loud and more refined.

Details matter this season. Better fits, cleaner necklines, subtle textures, and versatile styling make the difference.

OATCLUB’s new season direction is built around everyday luxury — fashion that feels current, wearable, and confident.
    `,
    isPublished: true,
  },
];

async function seedBlogs() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    const slugs = blogs.map((blog) => blog.slug);

    // Delete old dummy blogs with same slugs
    await Blog.deleteMany({ slug: { $in: slugs } });
    console.log("🧹 Old dummy blogs removed");

    const createdBlogs = await Blog.insertMany(blogs);
    console.log(`✅ ${createdBlogs.length} dummy blogs inserted`);

    console.log(
      createdBlogs.map((blog) => ({
        title: blog.title,
        slug: blog.slug,
      }))
    );

    process.exit(0);
  } catch (error) {
    console.error("❌ Blog seeding failed:", error);
    process.exit(1);
  }
}

seedBlogs();