export type ProfilePane = "overview" | "costs" | "reviews" | "details";

export type ProfileNavigation = {
  pane: ProfilePane;
  targetId?: string;
};
