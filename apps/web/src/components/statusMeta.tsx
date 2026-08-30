import type { EstagioOperacional } from "@prospect/shared";

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

const IconClock = (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const IconFlame = (
  <svg {...iconProps}>
    <path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-2 .5 2-1 3-2 3-2 0-2-2-1-4 .5-1 0-3-2-4z" />
  </svg>
);

const IconBag = (
  <svg {...iconProps}>
    <path d="M6 8h12l-1 12H7L6 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

const IconTruck = (
  <svg {...iconProps}>
    <rect x="1" y="7" width="13" height="10" rx="1" />
    <path d="M14 10h4l3 3v4h-7z" />
    <circle cx="6" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
  </svg>
);

const IconX = (
  <svg {...iconProps}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Única fonte de verdade de cor/ícone/label por estágio do board unificado
 * (tarefa 0067) — usada no Kanban e na tela de atendimento, pra garantir
 * que o mesmo estágio pareça igual em todo lugar (ver
 * docs/product/07-ux-multitenant-fluxos.md §7.1). */
export const STATUS_META: Record<EstagioOperacional, StatusMeta> = {
  ia_atendendo: {
    label: "IA atendendo",
    accentVar: "var(--ia)",
    accentBgVar: "var(--ia-bg)",
    icon: IconIA,
  },
  solicitou_humano: {
    label: "Solicitou humano",
    accentVar: "var(--amber)",
    accentBgVar: "var(--amber-bg)",
    icon: IconAlert,
  },
  humano_atendendo: {
    label: "Humano atendendo",
    accentVar: "var(--blue)",
    accentBgVar: "var(--blue-bg)",
    icon: IconHeadset,
  },
  // Nunca aparece como coluna do Kanban (ver KANBAN_COLUNAS) — só existe
  // aqui pra `STATUS_META` cobrir o tipo inteiro de `EstagioOperacional`,
  // usado se algum lugar exibir um atendimento resolvido individualmente.
  resolvido: {
    label: "Resolvido",
    accentVar: "var(--gray)",
    accentBgVar: "var(--gray-bg)",
    icon: IconCheck,
  },
  aberto: {
    label: "Aberto",
    accentVar: "var(--gray)",
    accentBgVar: "var(--gray-bg)",
    icon: IconClock,
  },
  em_preparacao: {
    label: "Em preparação",
    accentVar: "var(--amber)",
    accentBgVar: "var(--amber-bg)",
    icon: IconFlame,
  },
  pronto: {
    label: "Pronto",
    accentVar: "var(--blue)",
    accentBgVar: "var(--blue-bg)",
    icon: IconBag,
  },
  entregue: {
    label: "Entregue",
    accentVar: "var(--green, var(--blue))",
    accentBgVar: "var(--green-bg, var(--blue-bg))",
    icon: IconTruck,
  },
  cancelado: {
    label: "Cancelado",
    accentVar: "var(--red)",
    accentBgVar: "var(--red-bg)",
    icon: IconX,
  },
};

export const KANBAN_COLUNAS: EstagioOperacional[] = [
  "ia_atendendo",
  "solicitou_humano",
  "humano_atendendo",
  "aberto",
  "em_preparacao",
  "pronto",
  "entregue",
  "cancelado",
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
