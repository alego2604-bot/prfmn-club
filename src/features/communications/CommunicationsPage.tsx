import { useState } from "react";
import { Badge, Button, Card, Tabs } from "@/design-system/components";
import { Mail, MessageCircle, Bell } from "lucide-react";

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "push", label: "Push" },
] as const;

const SEGMENTS = ["Todos", "Clientes activos", "Clientes inactivos", "Nuevos", "Impagados", "Por tarifa", "Por clase", "Segmento personalizado"];

const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, push: Bell } as const;

export default function CommunicationsPage() {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["value"]>("email");
  const Icon = CHANNEL_ICON[channel];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Comunicaciones</h2>
        <p className="mt-1 text-sm text-text-tertiary">Envía mensajes segmentados. WhatsApp y Push preparados en arquitectura.</p>
      </div>

      <Tabs value={channel} onChange={setChannel} options={CHANNELS as unknown as { value: typeof channel; label: string }[]} />

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 text-text-secondary">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium">Nuevo mensaje por {channel}</span>
          {channel !== "email" && <Badge tone="warning">Requiere proveedor (roadmap)</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map((s) => (
            <button
              key={s}
              className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Escribe el mensaje..."
          className="mt-4 h-28 w-full resize-none rounded-xl border border-border-subtle bg-surface p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
        />
        <div className="mt-3 flex justify-end">
          <Button disabled={channel !== "email"}>Enviar</Button>
        </div>
      </Card>
    </div>
  );
}
