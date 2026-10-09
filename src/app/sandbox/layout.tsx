import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
    title: 'Karabast Sandbox',
};

export default function SandboxLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
