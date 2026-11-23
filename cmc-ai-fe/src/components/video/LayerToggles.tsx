import type { OverlayLayers } from '../../lib/overlay';

const ITEMS: { k: keyof OverlayLayers; label: string }[] = [
  { k: 'box', label: 'Khung' },
  { k: 'pose', label: 'Khung xương' },
  { k: 'label', label: 'Nhãn' },
  { k: 'conf', label: 'Độ tin cậy' },
];

export function LayerToggles({ value, onChange, dark, hide = [] }: { value: OverlayLayers; onChange(v: OverlayLayers): void; dark?: boolean; hide?: (keyof OverlayLayers)[] }) {
  return (
    <div className={`layer-toggles ${dark ? 'dark' : ''}`} role="group" aria-label="Lớp hiển thị">
      {ITEMS.filter((i) => !hide.includes(i.k)).map((i) => (
        <button key={i.k} className={value[i.k] ? 'on' : ''} aria-pressed={value[i.k]} onClick={() => onChange({ ...value, [i.k]: !value[i.k] })}>
          <i />
          {i.label}
        </button>
      ))}
    </div>
  );
}
