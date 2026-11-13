import type { ReactNode, RefObject } from "react";
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import { X } from "lucide-react";

export default function CareSearchDrawer({
  open,
  onDismiss,
  trigger,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DrawerBackdrop className="care-filter-backdrop" />
      <DrawerContent
        className="care-filter-drawer"
        initialFocus="content"
        finalFocus={() => trigger.current}
      >
        <div className="care-filter-grip" aria-hidden="true" />
        <div className="care-filter-heading">
          <DrawerTitle>Filter care options</DrawerTitle>
          <DrawerClose className="care-filter-close" aria-label="Close filters">
            <X size={20} aria-hidden="true" />
          </DrawerClose>
        </div>
        <div className="care-filter-scroll">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
