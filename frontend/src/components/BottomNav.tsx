"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomNav.module.css";

export default function BottomNav() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/", label: "MARKETS" },
    { href: "/agent", label: "AGENT" },
    { href: "/leaderboard", label: "LEADERBOARD" },
    { href: "/claims", label: "CLAIMS" },
  ];

  return (
    <div className={styles.bottomNavContainer}>
      <nav className={styles.bottomNav}>
        {navLinks.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link 
              key={link.href} 
              href={link.href} 
              className={`${styles.navLink} ${isActive ? styles.active : ""}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
