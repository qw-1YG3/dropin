import type { ReactElement } from "react";

type IconProps = {
  className?: string;
};

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function ComfortableListIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

export function CompactListIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DirectionsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 11l8-8 8 8" />
      <path d="M11 3v18" />
    </svg>
  );
}

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 4h3.2l1.5 4.3-2 1.6a11 11 0 0 0 5.4 5.4l1.6-2 4.3 1.5V18a2 2 0 0 1-2.2 2C10.5 19.5 4.5 13.5 3 7.2A2 2 0 0 1 5 4z" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 13a4.5 4.5 0 0 0 6.4 0l2.1-2.1a4.5 4.5 0 0 0-6.4-6.4L10.5 6" />
      <path d="M14 11a4.5 4.5 0 0 0-6.4 0L5.5 13a4.5 4.5 0 0 0 6.4 6.4L13.5 18" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="17.5" cy="5.5" r="2.3" />
      <circle cx="17.5" cy="18.5" r="2.3" />
      <line x1="8" y1="10.8" x2="15.5" y2="6.7" />
      <line x1="8" y1="13.2" x2="15.5" y2="17.3" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 4l-8 8 8 8" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 4l8 8-8 8" />
    </svg>
  );
}

export function LocationIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function BadmintonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <ellipse cx="12" cy="8" rx="5" ry="6" />
      <line x1="9" y1="5.5" x2="15" y2="10.5" />
      <line x1="15" y1="5.5" x2="9" y2="10.5" />
      <line x1="12" y1="14" x2="12" y2="21" />
    </svg>
  );
}

export function SwimmingIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2 13c1.5 1.6 3 1.6 4.5 0s3-1.6 4.5 0 3 1.6 4.5 0 3-1.6 4.5 0" />
      <path d="M2 17.5c1.5 1.6 3 1.6 4.5 0s3-1.6 4.5 0 3 1.6 4.5 0 3-1.6 4.5 0" />
      <circle cx="15" cy="6" r="2" />
    </svg>
  );
}

export function PickleballIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.5" y="2.5" width="9" height="12.5" rx="4.3" />
      <line x1="10" y1="15" x2="10" y2="21" />
      <circle cx="18.5" cy="17.5" r="2" />
    </svg>
  );
}

export function BasketballIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 2.2 3 15.8 0 18" />
      <path d="M12 3c-3 2.2-3 15.8 0 18" />
    </svg>
  );
}

export function YogaIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 14V8.5" />
      <path d="M8 10.5l4-2 4 2" />
      <path d="M6 20c0-4 2.5-6.5 6-6.5s6 2.5 6 6.5" />
    </svg>
  );
}

export function OpenGymIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="1.5" y="9" width="3" height="6" rx="1" />
      <rect x="19.5" y="9" width="3" height="6" rx="1" />
      <rect x="5" y="7" width="2.3" height="10" rx="1" />
      <rect x="16.7" y="7" width="2.3" height="10" rx="1" />
      <line x1="7.3" y1="12" x2="16.7" y2="12" />
    </svg>
  );
}

export const ACTIVITY_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  Badminton: BadmintonIcon,
  Swimming: SwimmingIcon,
  Pickleball: PickleballIcon,
  Basketball: BasketballIcon,
  Yoga: YogaIcon,
  "Open Gym": OpenGymIcon,
};
