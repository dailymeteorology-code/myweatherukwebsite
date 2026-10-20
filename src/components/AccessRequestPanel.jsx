import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from '@/components/ThemeContext';

export default function AccessRequestPanel() {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const { isDark } = useTheme();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['accessRequests'],
    queryFn: () => base44.entities.AccessRequest.list('-created_date'),
  });

  const { mutate: processRequest, isPending } = useMutation({
    // Optimistic update: flip the badge immediately so the admin sees instant
    // feedback without waiting for the network round-trip + email sends.
    onMutate: async ({ request_id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['accessRequests'] });
      const previous = queryClient.getQueryData(['accessRequests']);
      queryClient.setQueryData(['accessRequests'], (old = []) =>
        old.map(r => r.id === request_id ? { ...r, status } : r)
      );
      return { previous };
    },
    mutationFn: async ({ request_id, status }) => {
      const request = requests.find(r => r.id === request_id);
      if (!request) throw new Error('Request not found');

      // Persist the status change
      await base44.entities.AccessRequest.update(request_id, {
        status,
        admin_notes: adminNotes,
        email_sent: true,
      });

      if (status === 'approved') {
        // Generate unique secure access code
        const code = [
          Math.random().toString(36).substring(2, 6),
          Math.random().toString(36).substring(2, 6),
          Math.random().toString(36).substring(2, 6),
        ].join('-').toUpperCase();

        // Create SiteAccessCode record linked to this user
        await base44.entities.SiteAccessCode.create({
          email: request.email,
          code,
          is_active: true,
          notes: `Auto-generated for approved request: ${request.full_name}`,
        });

        // Send approval email
        await base44.integrations.Core.SendEmail({
          to: request.email,
          subject: 'Access Approved – Welcome to MyWeather',
          body: `Hi ${request.full_name},\n\nGreat news — your request to access MyWeather has been approved.\n\nYou can now proceed to access the website using your unique access code, which will be provided in a separate email shortly.\n\nWe're excited to have you on board.\n\n– MyWeather Team`,
        });

        // Send access code email
        await base44.integrations.Core.SendEmail({
          to: request.email,
          subject: 'Your Access Code – MyWeather',
          body: `Hi ${request.full_name},\n\nYour access to MyWeather is now active.\n\nHere is your unique access code:\n\n  ${code}\n\nEnter this code on the website to gain full access.\n\nPlease keep this code secure and do not share it with others.\n\nIf you experience any issues, feel free to contact us.\n\nEnjoy the experience.\n\n– MyWeather Team`,
        });

        console.log(`[AccessRequest] APPROVED: ${request.full_name} (${request.email}) — Code: ${code}`);
      } else {
        // Send rejection email
        await base44.integrations.Core.SendEmail({
          to: request.email,
          subject: 'Access Request Update – MyWeather',
          body: `Hi ${request.full_name},\n\nThank you for your interest in MyWeather.\n\nUnfortunately, we're unable to approve your access request at this time.\n\nWe may reopen applications again in the future, so please feel free to try again later.\n\nThank you for your understanding.\n\n– MyWeather Team`,
        });

        console.log(`[AccessRequest] REJECTED: ${request.full_name} (${request.email})`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] });
      setSelectedRequest(null);
      setAdminNotes('');
      toast.success('Request processed and email sent');
    },
    /* one handler: a second onError key further up used to be silently replaced by this one,
       so a failed request never rolled the optimistic badge back */
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['accessRequests'], ctx.previous);
      console.error('[AccessRequest] Error:', error);
      toast.error(error.message || 'Failed to process request');
    }
  });

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':   return <div className="flex items-center gap-2 text-yellow-600"><Clock className="w-4 h-4" /> Pending</div>;
      case 'approved':  return <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="w-4 h-4" /> Approved</div>;
      case 'rejected':  return <div className="flex items-center gap-2 text-red-600"><XCircle className="w-4 h-4" /> Rejected</div>;
      default: return status;
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-sky-500" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Pending Requests ({pendingRequests.length})
        </h3>
        {pendingRequests.length === 0 ? (
          <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>No pending requests</p>
        ) : (
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <Card
                key={request.id}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedRequest?.id === request.id
                    ? isDark ? 'bg-sky-500/20 border-sky-500' : 'bg-sky-50 border-sky-300'
                    : isDark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-slate-50'
                }`}
                onClick={() => setSelectedRequest(request)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{request.full_name}</p>
                    <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{request.email}</p>
                    <p className={`text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>@{request.social_media_handle}</p>
                  </div>
                  {getStatusBadge(request.status)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selectedRequest && selectedRequest.status === 'pending' && (
        <Card className={`p-6 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
          <h4 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>Review Request</h4>
          <div className="space-y-3 mb-4">
            <div>
              <p className={`text-xs font-semibold uppercase ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>Full Name</p>
              <p className={isDark ? 'text-white' : 'text-slate-900'}>{selectedRequest.full_name}</p>
            </div>
            <div>
              <p className={`text-xs font-semibold uppercase ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>Email</p>
              <p className={isDark ? 'text-white' : 'text-slate-900'}>{selectedRequest.email}</p>
            </div>
            <div>
              <p className={`text-xs font-semibold uppercase ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>Reason / Social Handle</p>
              <p className={isDark ? 'text-white' : 'text-slate-900'}>{selectedRequest.social_media_handle}</p>
            </div>
          </div>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Admin Notes (optional)</label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Add notes or rejection reason..."
              className={`min-h-20 ${isDark ? 'bg-slate-700 border-slate-600 text-white' : ''}`}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => processRequest({ request_id: selectedRequest.id, status: 'approved' })} disabled={isPending} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
              {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Approve & Send Code
            </Button>
            <Button onClick={() => processRequest({ request_id: selectedRequest.id, status: 'rejected' })} disabled={isPending} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
              {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
              Reject
            </Button>
          </div>
        </Card>
      )}

      {processedRequests.length > 0 && (
        <div>
          <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>Processed ({processedRequests.length})</h3>
          <div className="space-y-2">
            {processedRequests.map((request) => (
              <Card key={request.id} className={`p-3 ${isDark ? 'bg-slate-800' : 'bg-slate-50'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`font-medium text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>{request.full_name}</p>
                    <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{request.email}</p>
                  </div>
                  {getStatusBadge(request.status)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}