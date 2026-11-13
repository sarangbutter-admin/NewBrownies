import React, { useState } from 'react';
import { GRIND_OPTIONS, SIZE_OPTIONS } from '../data/storeData';

function AttributeMeter({ label, value }) {
  return (
    <div className="meter-item">
      <span className="meter-label">{label}</span>
      <div className="meter-dots" aria-label={`${label} ${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`meter-dot ${n <= value ? 'filled' : ''}`} />
        ))}
      </div>
    </div>
  );
}

export default function ProductCard({
  product,
  activeStoreId,
  fulfillmentMode,
  onAddToCart,
  onOpenDetail,
}) {
  const [grind, setGrind] = useState(GRIND_OPTIONS[0]);
  const [sizeLabel, setSizeLabel] = useState(SIZE_OPTIONS[0].label);

  const sizeObj = SIZE_OPTIONS.find((s) => s.label === sizeLabel) || SIZE_OPTIONS[0];
  const unitPrice = product.hasSize
    ? +(product.price * sizeObj.multiplier).toFixed(2)
    : product.price;

  const isAvailable =
    fulfillmentMode === 'delivery'
      ? product.category !== 'Cafe Drinks'
      : Boolean(product.inStock[activeStoreId]);

  const handleQuickAdd = () => {
    if (!isAvailable) return;
    onAddToCart({
      product,
      grind: product.hasGrind ? grind : null,
      size: product.hasSize ? sizeLabel : null,
      unitPrice,
      quantity: 1,
    });
  };

  return (
    <article className="product-card">
      <div className="product-media" onClick={() => onOpenDetail(product)}>
        <img src={product.image} alt={product.title} loading="lazy" />
        <div className="product-badges">
          {product.roastLabel && <span className="roast-badge">{product.roastLabel}</span>}
          {product.badge && <span className="special-badge">{product.badge}</span>}
        </div>
      </div>

      <div className="product-body">
        <div className="product-top">
          <h3 className="product-title" onClick={() => onOpenDetail(product)}>
            {product.title}
          </h3>
          <span className="product-price">${unitPrice.toFixed(2)}</span>
        </div>

        <p className="product-notes">{product.tastingNotes}</p>

        {product.meters && (
          <div className="meters-row">
            <AttributeMeter label="Roast" value={product.meters.roast} />
            <AttributeMeter label="Acidity" value={product.meters.acidity} />
            <AttributeMeter label="Body" value={product.meters.body} />
          </div>
        )}

        {(product.hasGrind || product.hasSize) && (
          <div className="variant-row">
            {product.hasGrind && (
              <select
                className="field-select"
                aria-label="Select grind"
                value={grind}
                onChange={(e) => setGrind(e.target.value)}
              >
                {GRIND_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            {product.hasSize && (
              <select
                className="field-select"
                aria-label="Select bag size"
                value={sizeLabel}
                onChange={(e) => setSizeLabel(e.target.value)}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="product-actions">
          <span className={`stock-status ${isAvailable ? '' : 'out'}`}>
            {fulfillmentMode === 'delivery'
              ? product.category === 'Cafe Drinks'
                ? 'Pickup only'
                : 'Ships today'
              : isAvailable
              ? 'In stock'
              : 'Out at store'}
          </span>
          <button
            type="button"
            className="quick-add-btn"
            disabled={!isAvailable}
            onClick={handleQuickAdd}
          >
            {isAvailable ? '+ Add to Order' : 'Unavailable'}
          </button>
        </div>
      </div>
    </article>
  );
}
