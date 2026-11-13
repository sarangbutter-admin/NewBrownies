import React from 'react';
import { X, Trash2, Store, Truck, ShoppingBag } from 'lucide-react';

const FREE_SHIPPING_THRESHOLD = 45;

export default function CartDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQty,
  onRemoveItem,
  orderNote,
  onOrderNoteChange,
  fulfillmentMode,
  onFulfillmentChange,
  activeStore,
  onCheckout,
}) {
  if (!isOpen) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const remainingForFree = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const progressPct = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <aside className="drawer-panel" onClick={(e) => e.stopPropagation()} aria-label="Your Order">
        <div className="drawer-header">
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600 }}>Your Weborder</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {fulfillmentMode === 'pickup'
                ? `Pickup · ${activeStore.name} (${activeStore.prepTime})`
                : 'Local Delivery & Shipping'}
            </p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close cart">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className={`filter-pill ${fulfillmentMode === 'pickup' ? 'active' : ''}`}
              onClick={() => onFulfillmentChange('pickup')}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Store size={15} /> Store Pickup
            </button>
            <button
              type="button"
              className={`filter-pill ${fulfillmentMode === 'delivery' ? 'active' : ''}`}
              onClick={() => onFulfillmentChange('delivery')}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Truck size={15} /> Delivery
            </button>
          </div>

          {fulfillmentMode === 'delivery' && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13 }}>
                {remainingForFree === 0
                  ? 'You unlocked FREE local delivery & shipping!'
                  : `Add $${remainingForFree.toFixed(2)} more for free local delivery`}
              </p>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="drawer-body">
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
              <ShoppingBag size={40} style={{ margin: '0 auto 12px', opacity: 0.6 }} />
              <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>
                Your bag is empty
              </p>
              <p style={{ fontSize: 14, marginTop: 6 }}>
                Add freshly roasted beans, cold brew, or cafe drinks to start your order.
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div className="cart-item" key={item.key}>
                <img src={item.product.image} alt={item.product.title} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 16, lineHeight: 1.2 }}>{item.product.title}</strong>
                    <span style={{ fontWeight: 600 }}>
                      ${(item.unitPrice * item.quantity).toFixed(2)}
                    </span>
                  </div>
                  {(item.size || item.grind) && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {[item.size, item.grind].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <div className="qty-control">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.key, item.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.key, item.quantity + 1)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.key)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 13,
                      }}
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {cart.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <label
                htmlFor="cart-note"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}
              >
                Order / Barista Note or Gift Message
              </label>
              <textarea
                id="cart-note"
                rows={2}
                className="field-input"
                placeholder="e.g., Extra hot, leave at front desk, or gift note..."
                value={orderNote}
                onChange={(e) => onOrderNoteChange(e.target.value)}
              />
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="drawer-footer">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>Subtotal</span>
              <strong style={{ fontSize: 20 }}>${subtotal.toFixed(2)}</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Taxes calculated at checkout.
            </p>
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={onCheckout}
            >
              Proceed to Weborder Checkout · ${subtotal.toFixed(2)}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
