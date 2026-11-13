import React, { useState, useMemo, useEffect } from 'react';
import {
  MapPin,
  Search,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Flame,
  Clock,
  Leaf,
  Award,
  ArrowRight,
  Coffee,
} from 'lucide-react';
import { STORES, PRODUCTS, BREW_GUIDES } from './data/storeData';
import ProductCard from './components/ProductCard';
import CartDrawer from './components/CartDrawer';
import {
  StoreSelectorModal,
  SearchModal,
  ProductDetailModal,
  CheckoutModal,
} from './components/Modals';

const ANNOUNCEMENTS = [
  'Free local delivery & shipping on orders over $45 · Roasted every Tuesday & Friday',
  'New Micro-Lot: Colombia Huila Pink Bourbon — Order online for 15-min cafe pickup',
  'Subscribe & save 15% on your favorite single-origin beans',
];

const CATEGORIES = ['All', 'Whole Bean', 'Cold Brew & RTD', 'Cafe Drinks', 'Brew Gear'];
const ROAST_FILTERS = [
  { id: 'all', label: 'All Roasts' },
  { id: 'light', label: 'Light Roast' },
  { id: 'medium', label: 'Medium Roast' },
  { id: 'dark', label: 'Dark Roast' },
];

export default function App() {
  const [announcementIdx, setAnnouncementIdx] = useState(0);
  const [activeStoreId, setActiveStoreId] = useState(STORES[0].id);
  const [fulfillmentMode, setFulfillmentMode] = useState('pickup');

  const [categoryFilter, setCategoryFilter] = useState('All');
  const [roastFilter, setRoastFilter] = useState('all');
  const [activeBrewId, setActiveBrewId] = useState(BREW_GUIDES[0].id);

  const [cart, setCart] = useState([]);
  const [orderNote, setOrderNote] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const activeStore = useMemo(
    () => STORES.find((s) => s.id === activeStoreId) || STORES[0],
    [activeStoreId]
  );

  const filteredProducts = useMemo(() => {
    return PRODUCTS.filter((p) => {
      const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
      const matchRoast = roastFilter === 'all' || p.roast === roastFilter;
      return matchCat && matchRoast;
    });
  }, [categoryFilter, roastFilter]);

  const activeBrew = useMemo(
    () => BREW_GUIDES.find((b) => b.id === activeBrewId) || BREW_GUIDES[0],
    [activeBrewId]
  );

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleAddToCart = ({ product, grind, size, unitPrice, quantity }) => {
    const key = `${product.id}__${size || 'std'}__${grind || 'std'}`;
    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) =>
          i.key === key ? { ...i, quantity: i.quantity + quantity } : i
        );
      }
      return [...prev, { key, product, grind, size, unitPrice, quantity }];
    });
    setToast(`Added ${product.title} to your order`);
  };

  const handleUpdateQty = (key, newQty) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((i) => i.key !== key));
      return;
    }
    setCart((prev) => prev.map((i) => (i.key === key ? { ...i, quantity: newQty } : i)));
  };

  const handleRemoveItem = (key) => {
    setCart((prev) => prev.filter((i) => i.key !== key));
  };

  const handleNewsletterSubmit = (e) => {
    e.preventDefault();
    if (!newsletterEmail.trim()) return;
    setToast(`Subscribed ${newsletterEmail} — 10% off code: CAFFEINE10`);
    setNewsletterEmail('');
  };

  return (
    <div>
      {/* Announcement Bar */}
      <div className="announcement-bar">
        <button
          type="button"
          aria-label="Previous announcement"
          onClick={() =>
            setAnnouncementIdx((i) => (i - 1 + ANNOUNCEMENTS.length) % ANNOUNCEMENTS.length)
          }
        >
          <ChevronLeft size={16} />
        </button>
        <span>{ANNOUNCEMENTS[announcementIdx]}</span>
        <button
          type="button"
          aria-label="Next announcement"
          onClick={() => setAnnouncementIdx((i) => (i + 1) % ANNOUNCEMENTS.length)}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Header */}
      <header className="site-header">
        <div className="header-inner">
          <a href="#top" className="brand-logo">
            <span className="brand-wordmark">Caffeine</span>
            <span className="brand-sub">Local Coffee Roasters</span>
          </a>

          <nav className="main-nav" aria-label="Primary">
            <a href="#shop">Shop Coffee</a>
            <a href="#brew-guides">Brew Guides</a>
            <a href="#locations">Locations</a>
            <a href="#story">Our Story</a>
          </nav>

          <div className="header-actions">
            <button
              type="button"
              className="store-pill-btn"
              onClick={() => setIsStoreModalOpen(true)}
            >
              <MapPin size={15} />
              <span className="store-label-text">
                {fulfillmentMode === 'pickup' ? `Pickup: ${activeStore.name}` : 'Local Delivery'}
              </span>
            </button>

            <button
              type="button"
              className="icon-btn"
              aria-label="Search store"
              onClick={() => setIsSearchOpen(true)}
            >
              <Search size={17} />
            </button>

            <button
              type="button"
              className="icon-btn cart-btn"
              onClick={() => setIsCartOpen(true)}
            >
              <ShoppingBag size={17} />
              <span>Order</span>
              <span className="cart-badge">{cartCount}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="container">
        {/* Hero Section */}
        <section className="hero-section">
          <div className="hero-card">
            <div className="hero-content">
              <div>
                <span className="hero-eyebrow">
                  <Flame size={14} /> Small-Batch Roastery &amp; Espresso Bar
                </span>
                <h1 className="hero-title">Craft coffee, roasted local &amp; poured fresh.</h1>
                <p className="hero-subtitle">
                  Order whole-bean single origins, chilled nitro cold brew, or barista-crafted
                  drinks online for 15-minute cafe pickup or same-day local delivery.
                </p>
                <div className="hero-cta-row">
                  <a href="#shop" className="btn-primary">
                    Order Coffee <ArrowRight size={17} />
                  </a>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsStoreModalOpen(true)}
                  >
                    {fulfillmentMode === 'pickup'
                      ? `Pickup · ${activeStore.name}`
                      : 'Switch to Store Pickup'}
                  </button>
                </div>
              </div>

              <div className="hero-meta-strip">
                <div className="hero-meta-item">
                  <strong>Next Roast</strong>
                  <span>Tomorrow · 6:00 AM</span>
                </div>
                <div className="hero-meta-item">
                  <strong>Active Store</strong>
                  <span>{activeStore.name}</span>
                </div>
                <div className="hero-meta-item">
                  <strong>Pickup Prep</strong>
                  <span>{activeStore.prepTime}</span>
                </div>
              </div>
            </div>

            <div className="hero-media">
              <img
                src="https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1000&q=80"
                alt="Fresh espresso poured at Caffeine Local Roastery"
              />
              <div className="hero-floating-tag">
                <div>
                  <div style={{ fontSize: 12, opacity: 0.75, textTransform: 'uppercase' }}>
                    Featured Roast
                  </div>
                  <strong style={{ fontSize: 17 }}>Ethiopia Yirgacheffe · Light Roast</strong>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '9px 16px', fontSize: 14 }}
                  onClick={() => setSelectedProduct(PRODUCTS[0])}
                >
                  Quick View
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* USP Strip */}
        <section className="usp-section" aria-label="Store highlights">
          <div className="usp-grid">
            <div className="usp-card">
              <Flame size={22} />
              <div>
                <h3>Roasted Twice Weekly</h3>
                <p>Small-batch drum roasting for peak sweetness and crema.</p>
              </div>
            </div>
            <div className="usp-card">
              <Clock size={22} />
              <div>
                <h3>15-Min Cafe Pickup</h3>
                <p>Skip the morning line at any of our 3 Portland bars.</p>
              </div>
            </div>
            <div className="usp-card">
              <Award size={22} />
              <div>
                <h3>Direct Trade Lots</h3>
                <p>Transparent farm-gate pricing above Fair Trade.</p>
              </div>
            </div>
            <div className="usp-card">
              <Leaf size={22} />
              <div>
                <h3>Compostable Bags</h3>
                <p>100% plant-based valves and recyclable kraft pouches.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Shop Catalog */}
        <section id="shop" className="section-block">
          <div className="section-header">
            <div>
              <h2 className="section-title">Order Online</h2>
            </div>
            <p className="section-desc">
              Showing live availability for{' '}
              <strong>
                {fulfillmentMode === 'pickup' ? activeStore.name : 'Local Delivery & Shipping'}
              </strong>
              .
            </p>
          </div>

          <div className="filter-bar">
            <div className="filter-pills" role="tablist" aria-label="Product categories">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="filter-pills" role="tablist" aria-label="Roast level">
              {ROAST_FILTERS.map((rf) => (
                <button
                  key={rf.id}
                  type="button"
                  className={`filter-pill ${roastFilter === rf.id ? 'active' : ''}`}
                  onClick={() => setRoastFilter(rf.id)}
                >
                  {rf.label}
                </button>
              ))}
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div
              style={{
                padding: 48,
                textAlign: 'center',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-card)',
              }}
            >
              <p style={{ fontSize: 20, fontWeight: 500 }}>No items match those filters.</p>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 16 }}
                onClick={() => {
                  setCategoryFilter('All');
                  setRoastFilter('all');
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  activeStoreId={activeStoreId}
                  fulfillmentMode={fulfillmentMode}
                  onAddToCart={handleAddToCart}
                  onOpenDetail={(p) => setSelectedProduct(p)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Brew Guides */}
        <section id="brew-guides" className="section-block">
          <div className="section-header">
            <h2 className="section-title">Dialed-In Brew Guides</h2>
            <p className="section-desc">
              Exact ratios, temperatures, and recipes tested daily by our head roaster.
            </p>
          </div>

          <div className="brew-card">
            <div className="brew-tabs">
              {BREW_GUIDES.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  className={`brew-tab ${activeBrewId === guide.id ? 'active' : ''}`}
                  onClick={() => setActiveBrewId(guide.id)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <Coffee size={18} />
                    {guide.name}
                  </span>
                  <span style={{ fontSize: 14, opacity: 0.8 }}>{guide.ratio}</span>
                </button>
              ))}
            </div>

            <div>
              <div className="brew-specs-grid">
                <div className="brew-spec">
                  <span>Dose &amp; Yield</span>
                  <strong>{activeBrew.dose}</strong>
                </div>
                <div className="brew-spec">
                  <span>Water Temp</span>
                  <strong>{activeBrew.temp}</strong>
                </div>
                <div className="brew-spec">
                  <span>Total Brew Time</span>
                  <strong>{activeBrew.time}</strong>
                </div>
                <div className="brew-spec">
                  <span>Grind Setting</span>
                  <strong>{activeBrew.grind}</strong>
                </div>
              </div>

              <ol className="brew-steps">
                {activeBrew.steps.map((step, idx) => (
                  <li key={idx}>
                    <span className="step-num">{idx + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Locations */}
        <section id="locations" className="section-block">
          <div className="section-header">
            <h2 className="section-title">Our Local Cafes</h2>
            <p className="section-desc">
              Select your preferred pickup bar to check real-time bean &amp; drink availability.
            </p>
          </div>

          <div className="locations-grid">
            {STORES.map((store) => {
              const isSelected = fulfillmentMode === 'pickup' && activeStoreId === store.id;
              return (
                <div key={store.id} className={`location-card ${isSelected ? 'active' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 22, fontWeight: 600 }}>{store.name}</h3>
                    <span className="roast-badge">{store.prepTime}</span>
                  </div>
                  <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>
                    {store.address}
                    <br />
                    {store.city}
                  </p>
                  <p style={{ fontSize: 14 }}>{store.hours}</p>
                  <div className="location-features">
                    {store.features.map((f) => (
                      <span key={f} className="location-tag">
                        {f}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={isSelected ? 'btn-primary' : 'btn-secondary'}
                    style={{ marginTop: 'auto', padding: '11px 18px', fontSize: 14 }}
                    onClick={() => {
                      setActiveStoreId(store.id);
                      setFulfillmentMode('pickup');
                      setToast(`Pickup store set to ${store.name}`);
                    }}
                  >
                    {isSelected ? 'Selected Pickup Store' : 'Set as Pickup Store'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Story Split Section */}
        <section id="story" className="section-block">
          <div className="hero-card">
            <div className="hero-media" style={{ minHeight: 380 }}>
              <img
                src="https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80"
                alt="Coffee roasting drum at Caffeine Roastery"
              />
            </div>
            <div className="hero-content">
              <div>
                <span className="hero-eyebrow">Our Philosophy</span>
                <h2 className="section-title" style={{ marginTop: 16 }}>
                  Traceable from farm to your morning cup.
                </h2>
                <p className="hero-subtitle">
                  Founded in 2019, Caffeine pairs direct-trade relationships with precision
                  small-batch roasting. Every bag is stamped with its roast date and dispatched
                  within 24 hours—or waiting warm on our espresso bar counter.
                </p>
              </div>
              <div>
                <a href="#shop" className="btn-primary">
                  Shop Fresh Roasts
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="brand-wordmark" style={{ color: 'var(--text-on-dark)' }}>
                Caffeine
              </div>
              <p style={{ marginTop: 12, fontSize: 15, maxWidth: 340 }}>
                Join our roast dispatch for micro-lot drops, brew recipes, and 10% off your first
                weborder.
              </p>
              <form className="newsletter-form" onSubmit={handleNewsletterSubmit}>
                <input
                  type="email"
                  required
                  className="newsletter-input"
                  placeholder="you@example.com"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                />
                <button type="submit" className="newsletter-btn">
                  Join
                </button>
              </form>
            </div>

            <div>
              <h4 className="footer-title">Shop</h4>
              <ul className="footer-links">
                <li><a href="#shop" onClick={() => setCategoryFilter('Whole Bean')}>Whole Bean</a></li>
                <li><a href="#shop" onClick={() => setCategoryFilter('Cold Brew & RTD')}>Cold Brew &amp; RTD</a></li>
                <li><a href="#shop" onClick={() => setCategoryFilter('Cafe Drinks')}>Cafe Drinks</a></li>
                <li><a href="#shop" onClick={() => setCategoryFilter('Brew Gear')}>Brew Gear</a></li>
              </ul>
            </div>

            <div>
              <h4 className="footer-title">Learn</h4>
              <ul className="footer-links">
                <li><a href="#brew-guides">Brew Guides</a></li>
                <li><a href="#story">Sourcing &amp; Roasting</a></li>
                <li><a href="#locations">Cafe Hours</a></li>
              </ul>
            </div>

            <div>
              <h4 className="footer-title">Flagship Roastery</h4>
              <ul className="footer-links">
                <li>142 Mercer St, Suite 100</li>
                <li>Portland, OR 97204</li>
                <li>(503) 555-0142</li>
                <li>hello@caffeinelocal.example</li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Caffeine Local Coffee Roasters. All rights reserved.</span>
            <span>USD $ · Visa · Mastercard · Apple Pay</span>
          </div>
        </div>
      </footer>

      {/* Drawers & Modals */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        orderNote={orderNote}
        onOrderNoteChange={setOrderNote}
        fulfillmentMode={fulfillmentMode}
        onFulfillmentChange={setFulfillmentMode}
        activeStore={activeStore}
        onCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      <StoreSelectorModal
        isOpen={isStoreModalOpen}
        onClose={() => setIsStoreModalOpen(false)}
        activeStoreId={activeStoreId}
        fulfillmentMode={fulfillmentMode}
        onSelectStore={(id) => {
          setActiveStoreId(id);
          setFulfillmentMode('pickup');
          const store = STORES.find((s) => s.id === id);
          if (store) setToast(`Switched pickup store to ${store.name}`);
        }}
        onSelectDelivery={() => {
          setFulfillmentMode('delivery');
          setToast('Switched to Local Delivery & Shipping');
        }}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        products={PRODUCTS}
        onSelectProduct={(p) => setSelectedProduct(p)}
      />

      <ProductDetailModal
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
        activeStoreId={activeStoreId}
        fulfillmentMode={fulfillmentMode}
        onAddToCart={handleAddToCart}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        fulfillmentMode={fulfillmentMode}
        activeStore={activeStore}
        orderNote={orderNote}
        onOrderComplete={() => {
          setCart([]);
          setOrderNote('');
        }}
      />

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
}
