'use client';
import dynamic from 'next/dynamic';

// Client-only: the sandbox reads localStorage and the URL fragment, and holds a live engine session.
const SandboxApp = dynamic(() => import('./_components/SandboxApp'), { ssr: false });

export default function SandboxPage() {
    return <SandboxApp />;
}
