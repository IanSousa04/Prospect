import type { StatusAtendimento } from "@prospect/shared";

export interface StatusMeta {
  label: string;
  accentVar: string;
  accentBgVar: string;
  icon: JSX.Element;
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconIA = (
  <svg {...iconProps}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </svg>
);

const IconAlert = (
  <svg {...iconProps}>
    <path d="M12 9v4M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const IconUserAlert = (
  <svg {...iconProps}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    <path d="M19 8h.01" />
  </svg>
);

const IconHeadset = (
  <svg {...iconProps}>
    <path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const IconCheck = (
  <svg {...iconProps}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/** Única fonte de verdade de cor/ícone/label por status — usada no Kanban e
 * na tela de atendimento, pra garantir que o mesmo status pareça igual em
 * todo lugar (ver docs/product/07-ux-multitenant-fluxos.md §7.1). */
export const STATUS_META: Record<StatusAtendimento, StatusMeta> = {
  ia_atendendo: {
    label: "IA atendendo",
    accentVar: "var(--ia)",
    accentBgVar: "var(--ia-bg)",
    icon: IconIA,
  },
  ia_solicitou_humano: {
    label: "IA solicitou humano",
    accentVar: "var(--amber)",
    accentBgVar: "var(--amber-bg)",
    icon: IconAlert,
  },
  cliente_solicitou_humano: {
    label: "Cliente solicitou humano",
    accentVar: "var(--red)",
    accentBgVar: "var(--red-bg)",
    icon: IconUserAlert,
  },
  humano_atendendo: {
    label: "Humano atendendo",
    accentVar: "var(--blue)",
    accentBgVar: "var(--blue-bg)",
    icon: IconHeadset,
  },
  resolvido: {
    label: "Resolvido",
    accentVar: "var(--gray)",
    accentBgVar: "var(--gray-bg)",
    icon: IconCheck,
  },
};

export const KANBAN_COLUNAS: StatusAtendimento[] = [
  "ia_atendendo",
  "ia_solicitou_humano",
  "cliente_solicitou_humano",
  "humano_atendendo",
  "resolvido",
];

export function tempoDecorrido(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}
