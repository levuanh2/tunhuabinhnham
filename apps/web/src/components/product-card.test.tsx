import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductCard } from "./product-card";

describe("ProductCard", () => {
  it("links to the detail and renders contact price", () => {
    render(<ProductCard product={{ id:"1", name:"Bình gốm", slug:"binh-gom", sku:"BG-1", price:null, stock_status:"contact", publish_status:"published", is_visible:true, is_featured:false, images:[], attributes:{} }} />);
    expect(screen.getByRole("link", { name: "Bình gốm" })).toHaveAttribute("href", "/san-pham/binh-gom");
    expect(screen.getByText("Liên hệ")).toBeInTheDocument();
  });
});
