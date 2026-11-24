"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setSpace } from "@/lib/store";

/** Tonight now lives on the films Home: old links and the app shortcut land there. */
export default function Tonight() {
  const router = useRouter();
  useEffect(() => {
    setSpace("films");
    router.replace("/#tonight");
  }, [router]);
  return <div className="card h-64 animate-pulse" />;
}
