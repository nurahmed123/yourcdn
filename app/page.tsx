import { redirect } from "next/navigation";
import { optionalAccount } from "@/lib/page-auth";
export default async function Home() {
  redirect((await optionalAccount()) ? "/dashboard" : "/login");
}
