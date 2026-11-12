export type ProfilePane = "overview" | "costs" | "reviews" | "details";

export type ProfileNavigation = {
  pane: ProfilePane;
  targetId?: string;
};

export type NavigateProfile = (destination: ProfileNavigation) => void;
