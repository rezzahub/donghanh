import { DongHanhWidget } from "@donghanh/widget";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root) createRoot(root).render(<DongHanhWidget appName="task-card" />);
