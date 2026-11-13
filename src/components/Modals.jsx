import React, { useState } from 'react';
import { X, MapPin, Clock, CheckCircle2, Search } from 'lucide-react';
import { STORES, GRIND_OPTIONS, SIZE_OPTIONS } from '../data/storeData';

export function StoreSelectorModal({
  isOpen,
  onClose,
  activeStoreId,
  fulfillmentMode,
  onSelectStore,
  onSelectDelivery,
}) {
  if (!isOpen) return null;

  return (
    <div className="overlay-backdrop centered" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose Store or Delivery">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 500 }}>Choose Fulfillment &amp; Store</h2>
            <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>
              Check live stock and order for cafe pickup or local delivery.
            </p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {STORES.map((store) => {
            const isSelected = fulfillmentMode === 'pickup' && activeStoreId === store.id;
            return (
              <div
                key={store.id}
                className={`location-card ${isSelected ? 'active' : ''}`}
                style={{ cursor: 'pointer', padding: 20 }}
                onClick={() => {
                  onSelectStore(store.id);
                  onClose();
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 20, fontWeight: 600 }}>{store.name}</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
                      <MapPin size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {store.address}, {store.city}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                      <Clock size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {store.hours}
                    </p>
                  </div>
                  <span className="roast-badge">{store.prepTime}</span>
                </div>
              </div>
            );
          })}

          <div
            className={`location-card ${fulfillmentMode === 'delivery' ? 'active' : ''}`}
            style={{ cursor: 'pointer', padding: 20 }}
            onClick={() => {
              onSelectDelivery();
              onClose();
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 600 }}>Local Delivery &amp; Shipping</h3>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
                  Free delivery on orders $45+ · Roasted &amp; dispatched within 24 hours.
                </p>
              </div>
              <span className="special-badge">SHIPS TODAY</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SearchModal({ isOpen, onClose, products, onSelectProduct }) {
  const [query, setQuery] = useState('');
  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const matches = q
    ? products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.tastingNotes.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.roastLabel && p.roastLabel.toLowerCase().includes(q))
      )
    : products.slice(0, 6);

  return (
    <div className="overlay-backdrop centered" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search store">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Search size={20} />
          <input
            type="text"
            autoFocus
            className="field-input"
            placeholder="Search beans, roast levels, tasting notes, or gear..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {matches.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: '20px 0' }}>
              No products match "{query}". Try "light roast", "espresso", or "V60".
            </p>
          ) : (
            matches.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  onSelectProduct(p);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: 12,
                  borderRadius: 14,
                  border: '1px solid var(--border-card)',
                  backgroundColor: 'var(--bg-card)',
                  cursor: 'pointer',
                }}
              >
                <img
                  src={p.image}
                  alt={p.title}
                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{p.title}</strong>
                    <strong>${p.price.toFixed(2)}</strong>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{p.tastingNotes}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ProductDetailModal({
  product,
  onClose,
  activeStoreId,
  fulfillmentMode,
  onAddToCart,
}) {
  const [grind, setGrind] = useState(GRIND_OPTIONS[0]);
  const [sizeLabel, setSizeLabel] = useState(SIZE_OPTIONS[0].label);
  const [qty, setQty] = useState(1);

  if (!product) return null;

  const sizeObj = SIZE_OPTIONS.find((s) => s.label === sizeLabel) || SIZE_OPTIONS[0];
  const unitPrice = product.hasSize
    ? +(product.price * sizeObj.multiplier).toFixed(2)
    : product.price;

  const isAvailable =
    fulfillmentMode === 'delivery'
      ? product.category !== 'Cafe Drinks'
      : Boolean(product.inStock[activeStoreId]);

  return (
    <div className="overlay-backdrop centered" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={product.title}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close product detail">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 28 }}>
          <div>
            <img
              src={product.image}
              alt={product.title}
              style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 16 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {product.roastLabel && <span className="roast-badge">{product.roastLabel}</span>}
              {product.badge && <span className="special-badge">{product.badge}</span>}
            </div>

            <h2 style={{ fontSize: 30, fontWeight: 500, lineHeight: 1.1 }}>{product.title}</h2>
            <p style={{ fontSize: 22, fontWeight: 600 }}>${unitPrice.toFixed(2)}</p>
            <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>{product.description}</p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                padding: 14,
                borderRadius: 12,
                border: '1px solid var(--border-card)',
                backgroundColor: 'var(--bg-card)',
                fontSize: 13,
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Origin</span>
                <strong>{product.origin}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Process</span>
                <strong>{product.process}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Elevation</span>
                <strong>{product.elevation}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Notes</span>
                <strong>{product.tastingNotes}</strong>
              </div>
            </div>

            {product.hasGrind && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Grind Preference
                </label>
                <select className="field-select" value={grind} onChange={(e) => setGrind(e.target.value)}>
                  {GRIND_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {product.hasSize && (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Bag Size
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {SIZE_OPTIONS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={`filter-pill ${sizeLabel === s.label ? 'active' : ''}`}
                      onClick={() => setSizeLabel(s.label)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <div className="qty-control">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty((q) => q + 1)}>
                  +
                </button>
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1 }}
                disabled={!isAvailable}
                onClick={() => {
                  onAddToCart({
                    product,
                    grind: product.hasGrind ? grind : null,
                    size: product.hasSize ? sizeLabel : null,
                    unitPrice,
                    quantity: qty,
                  });
                  onClose();
                }}
              >
                {isAvailable
                  ? `Add to Order · $${(unitPrice * qty).toFixed(2)}`
                  : 'Unavailable for selected method'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckoutModal({
  isOpen,
  onClose,
  cart,
  fulfillmentMode,
  activeStore,
  orderNote,
  onOrderComplete,
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [pickupSlot, setPickupSlot] = useState('ASAP (15–20 mins)');
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  if (!isOpen) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const deliveryFee = fulfillmentMode === 'delivery' && subtotal < 45 ? 5.95 : 0;
  const tax = +(subtotal * 0.08).toFixed(2);
  const total = +(subtotal + deliveryFee + tax).toFixed(2);

  const handleSubmit = (e) => {
    e.preventDefault();
    const orderNumber = `CAF-${Math.floor(100000 + Math.random() * 900000)}`;
    setConfirmedOrder({
      orderNumber,
      name,
      contact,
      total,
      fulfillmentMode,
      storeName: activeStore.name,
      pickupSlot,
      address,
    });
    onOrderComplete();
  };

  const handleCloseAll = () => {
    setConfirmedOrder(null);
    onClose();
  };

  return (
    <div className="overlay-backdrop centered" onClick={handleCloseAll}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Weborder Checkout">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 28, fontWeight: 500 }}>
            {confirmedOrder ? 'Order Confirmed' : 'Weborder Checkout'}
          </h2>
          <button type="button" className="close-btn" onClick={handleCloseAll} aria-label="Close checkout">
            <X size={18} />
          </button>
        </div>

        {confirmedOrder ? (
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <CheckCircle2 size={54} style={{ margin: '0 auto 14px', color: 'var(--accent-espresso)' }} />
            <h3 style={{ fontSize: 26, fontWeight: 600 }}>Thank you, {confirmedOrder.name}!</h3>
            <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              Order <strong>#{confirmedOrder.orderNumber}</strong> has been sent to our baristas &amp; roastery.
            </p>
            <div
              style={{
                margin: '24px auto',
                maxWidth: 420,
                padding: 20,
                borderRadius: 16,
                border: '1px solid var(--border-card)',
                backgroundColor: 'var(--bg-card)',
                textAlign: 'left',
                fontSize: 15,
              }}
            >
              <p>
                <strong>Fulfillment:</strong>{' '}
                {confirmedOrder.fulfillmentMode === 'pickup'
                  ? `Pickup at ${confirmedOrder.storeName} (${confirmedOrder.pickupSlot})`
                  : `Local Delivery to ${confirmedOrder.address}`}
              </p>
              <p style={{ marginTop: 6 }}>
                <strong>Confirmation sent to:</strong> {confirmedOrder.contact}
              </p>
              <p style={{ marginTop: 6 }}>
                <strong>Total Paid:</strong> ${confirmedOrder.total.toFixed(2)}
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={handleCloseAll}>
              Back to Store
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 14,
                border: '1px solid var(--border-card)',
                backgroundColor: 'var(--bg-card)',
                fontSize: 14,
              }}
            >
              <strong>
                {fulfillmentMode === 'pickup'
                  ? `Store Pickup · ${activeStore.name}`
                  : 'Local Delivery & Shipping'}
              </strong>
              <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                {fulfillmentMode === 'pickup'
                  ? `${activeStore.address}, ${activeStore.city}`
                  : 'Free delivery over $45 · $5.95 flat rate under $45'}
              </p>
              {orderNote && (
                <p style={{ marginTop: 6 }}>
                  <em>Note: "{orderNote}"</em>
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Full Name *
                </label>
                <input
                  required
                  className="field-input"
                  placeholder="Alex Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Email or Mobile Phone *
                </label>
                <input
                  required
                  className="field-input"
                  placeholder="alex@example.com"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
            </div>

            {fulfillmentMode === 'pickup' ? (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Pickup Window
                </label>
                <select
                  className="field-select"
                  value={pickupSlot}
                  onChange={(e) => setPickupSlot(e.target.value)}
                >
                  <option>ASAP (15–20 mins)</option>
                  <option>In 45 minutes</option>
                  <option>Today · 12:00 PM – 1:00 PM</option>
                  <option>Today · 3:00 PM – 4:00 PM</option>
                </select>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Delivery Address *
                </label>
                <input
                  required
                  className="field-input"
                  placeholder="1234 NW Couch St, Portland, OR"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            )}

            <div
              style={{
                borderTop: '1px solid var(--border-card)',
                paddingTop: 14,
                display: 'grid',
                gap: 6,
                fontSize: 15,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal ({cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{fulfillmentMode === 'pickup' ? 'Store Pickup' : 'Delivery'}</span>
                <span>{deliveryFee === 0 ? 'FREE' : `$${deliveryFee.toFixed(2)}`}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Estimated Tax</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 20,
                  fontWeight: 600,
                  marginTop: 6,
                }}
              >
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>

            <button type="submit" className="btn-primary" style={{ width: '100%' }}>
              Place Weborder · ${total.toFixed(2)}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
