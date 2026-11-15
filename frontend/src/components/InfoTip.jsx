import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * Compact information "i" icon that shows explanatory text on hover (title)
 * and toggles a clean popover on tap/click (for mobile-first usability).
 */
export default function InfoTip({ text, size = 14, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  if (!text) return null;

  return (
    <span className="infotip-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`infotip-btn ${open ? 'active' : ''}`}
        title={text}
        aria-label="More information"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <Info size={size} />
      </button>
      {open && (
        <span
          className={`infotip-popover ${align === 'right' ? 'infotip-right' : ''}`}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  );
}
