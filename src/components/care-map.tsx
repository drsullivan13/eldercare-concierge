"use client";
import { useEffect, useRef, useState } from "react";
import type { SearchProvider } from "@/lib/providers";
import "leaflet/dist/leaflet.css";
export default function CareMap({
  providers,
  origin,
  radius,
  onOpen,
}: {
  providers: SearchProvider[];
  origin: { lat: number; lng: number; city: string };
  radius: number;
  onOpen: (provider: SearchProvider) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let canceled = false;
    let map: import("leaflet").Map | undefined;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then((L) => {
      if (canceled || !ref.current) return;
      setFailed(false);
      map = L.map(ref.current, {
        scrollWheelZoom: false,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      }).setView([origin.lat, origin.lng], 11);
      const tiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        },
      );
      tiles.on("tileerror", () => {
        if (!canceled) setFailed(true);
      });
      tiles.addTo(map);
      L.circle([origin.lat, origin.lng], {
        radius: radius * 1609.344,
        color: "#26786d",
        weight: 1,
        fillOpacity: 0.035,
        dashArray: "5 6",
      }).addTo(map);
      L.circleMarker([origin.lat, origin.lng], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: "#172f39",
        fillOpacity: 1,
      })
        .bindTooltip(`Approximate ZIP location · ${origin.city}`)
        .addTo(map);
      providers.forEach((provider) => {
        if (provider.lat === null || provider.lng === null) return;
        const content = document.createElement("span");
        content.textContent =
          provider.name +
          (provider.locationKind === "zip"
            ? " · ZIP-area estimate; exact campus point unconfirmed"
            : "");
        L.circleMarker([provider.lat, provider.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor:
            provider.category === "nursing-home"
              ? "#26786d"
              : provider.category === "assisted-living"
                ? "#b78354"
                : provider.category === "life-plan"
                  ? "#8e6556"
                  : "#6a749d",
          fillOpacity: provider.locationKind === "zip" ? 0.5 : 0.9,
          dashArray: provider.locationKind === "zip" ? "2 2" : undefined,
        })
          .bindTooltip(content)
          .on("click", () => onOpen(provider))
          .addTo(map!);
      });
      const bounds = L.latLng([origin.lat, origin.lng]).toBounds(
        radius * 1609.344 * 2,
      );
      map.fitBounds(bounds, { padding: [12, 12] });
      observer = new ResizeObserver(() => map?.invalidateSize());
      observer.observe(ref.current);
    });
    return () => {
      canceled = true;
      observer?.disconnect();
      map?.remove();
    };
  }, [providers, origin, radius, onOpen]);
  return (
    <div className="map-wrap">
      <div ref={ref} className="care-map" aria-label="Map of care locations" />
      <div className="map-caption">
        <span>
          <i className="map-dot teal" />
          Nursing & rehab
        </span>
        <span>
          <i className="map-dot sand" />
          Assisted living
        </span>
        <span>
          <i className="map-dot campus" />
          Continuing care
        </span>
        <span>
          <i className="map-dot lavender" />
          Home services
        </span>
      </div>
      {failed && (
        <p className="small muted">
          Some map tiles could not load. The list and calculated distances are
          still available.
        </p>
      )}
    </div>
  );
}
