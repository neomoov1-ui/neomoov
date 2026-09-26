'use client';

/**
 * Champ d'adresse avec suggestions (motif combobox WAI-ARIA : flèches, Entrée, Échap), partagé par My Hub et la
 * réservation publique. Le lieu n'est retenu qu'une fois choisi dans la liste (coordonnées résolues par l'API).
 */
import type { AutocompleteSuggestion, Place, PlaceDetails } from '@neomoov/domain';
import { useEffect, useId, useRef, useState } from 'react';
import { cx, focus } from '@/components/ui/kit';

export interface AddressFieldProps {
  label: string;
  hint: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  search: (input: string, sessionToken: string) => Promise<AutocompleteSuggestion[]>;
  details: (placeId: string, sessionToken: string) => Promise<PlaceDetails>;
  error?: string | null | undefined;
  name?: string;
}

const newSession = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function AddressField({ label, hint, value, onChange, search, details, error, name }: AddressFieldProps) {
  const id = useId();
  const [text, setText] = useState(value?.address ?? '');
  const [items, setItems] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const session = useRef(newSession());
  const seq = useRef(0);

  useEffect(() => {
    if (value && value.address !== text) setText(value.address);
    // Synchronisation seulement quand le lieu choisi change de l'extérieur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const input = text.trim();
    if (input.length < 3 || (value && value.address === text)) {
      setItems([]);
      return;
    }
    const current = ++seq.current;
    const timer = setTimeout(() => {
      search(input, session.current)
        .then((found) => {
          if (current !== seq.current) return;
          setItems(found);
          setOpen(found.length > 0);
          setActive(-1);
        })
        .catch(() => setItems([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [text, value, search]);

  async function choose(item: AutocompleteSuggestion) {
    setOpen(false);
    setText(item.description);
    try {
      const place = await details(item.placeId, session.current);
      onChange({ address: place.address, coordinates: place.coordinates, ...(place.placeId ? { placeId: place.placeId } : {}) });
      setText(place.address);
    } catch {
      onChange(null);
    }
    session.current = newSession();
  }

  const listId = `${id}-list`;
  const describedBy = error ? `${id}-error` : `${id}-hint`;
  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-brand-ink">{label}</label>
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === 'Enter' && open && active >= 0 && items[active]) {
            e.preventDefault();
            void choose(items[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cx('w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-brand-night', focus)}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="absolute top-full z-[1000] mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-300 bg-white shadow-lg">
          {items.map((item, index) => (
            <li
              key={item.placeId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(item);
              }}
              className={cx('cursor-pointer px-3 py-2 text-sm', index === active ? 'bg-brand-tint text-brand-night' : 'hover:bg-brand-mist')}
            >
              {item.description}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p id={`${id}-error`} className="text-xs font-semibold text-red-800">{error}</p> : <p id={`${id}-hint`} className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}
