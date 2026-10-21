import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Copy, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '../utils';

export default function InvitationLinkGenerator() {
  const [invitationToken, setInvitationToken] = useState(localStorage.getItem('invitationToken') || generateToken());
  const [copied, setCopied] = useState(false);

  function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  const handleGenerateNew = () => {
    const newToken = generateToken();
    setInvitationToken(newToken);
    localStorage.setItem('invitationToken', newToken);
    toast.success('New invitation token generated');
  };

  const invitationUrl = `${window.location.origin}${createPageUrl('RequestAccess')}?token=${invitationToken}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(invitationUrl);
    setCopied(true);
    toast.success('Invitation link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="p-6 ad-legacy-card">
      <h3 className="text-lg font-semibold mb-4 ad-ink">
        Invitation Link
      </h3>
      <p className="text-sm mb-4 ad-ink-mid">
        Share this link with people you want to invite to request access to your site.
      </p>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="text"
            value={invitationUrl}
            readOnly
            className="flex-1 ad-field-bg"
          />
          <Button
            onClick={handleCopy}
            variant="outline"
            size="icon"
            className={copied ? 'bg-green-600 border-green-600 text-white' : ''}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        <Button
          onClick={handleGenerateNew}
          variant="outline"
          className="w-full"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Generate New Token
        </Button>
      </div>

      <div className="mt-4 p-3 rounded-lg ad-soft">
        <p className="text-xs ad-ink-mid">
          <strong>Current Token:</strong> {invitationToken}
        </p>
      </div>
    </Card>
  );
}