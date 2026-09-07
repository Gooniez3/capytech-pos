import { useState, useMemo } from 'react';
import { Plus, Search, MoreHorizontal, Edit, Trash2, Eye, UserCog, UserCheck, UserX } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { RoleBadge, StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/context/ToastContext';
import { users } from '@/data/store';
import { formatCurrency, formatNumber } from '@/lib/currency';
import { formatDate } from '@/lib/format';

export function StaffPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.username.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [search, roleFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        subtitle={`${users.length} staff members`}
        actions={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>Add Staff</Button>}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or username..."
            className="w-full h-10 rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-colors"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="cashier">Cashier</option>
        </select>
        <span className="text-sm text-slate-500 ml-auto">{filtered.length} staff</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<UserCog className="h-8 w-8" />} title="No staff found" description="Try a different search." />
        </Card>
      ) : (
        <DataTable
          data={filtered}
          rowKey={(u) => u.id}
          minWidth="900px"
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (u) => (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-semibold shrink-0">
                    {u.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{u.name}</p>
                    <p className="text-xs text-slate-400">@{u.username}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              render: (u) => <RoleBadge role={u.role} />,
            },
            {
              key: 'sales',
              header: 'Sales Made',
              align: 'center',
              render: (u) => <span className="font-semibold text-slate-700 tabular-nums">{formatNumber(u.salesMade)}</span>,
            },
            {
              key: 'revenue',
              header: 'Revenue',
              align: 'right',
              render: (u) => <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(u.revenue)}</span>,
            },
            {
              key: 'joined',
              header: 'Joined',
              render: (u) => <span className="text-sm text-slate-500">{formatDate(u.joinedAt)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (u) => (
                <StatusBadge variant={u.status === 'active' ? 'success' : 'neutral'} dot>
                  {u.status === 'active' ? 'Active' : 'Inactive'}
                </StatusBadge>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              render: (u) => (
                <div className="relative inline-block">
                  <button
                    onClick={() => setActionMenuId(actionMenuId === u.id ? null : u.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {actionMenuId === u.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenuId(null)} />
                      <div className="absolute right-0 mt-1 w-40 rounded-lg border border-slate-200 bg-white shadow-pop py-1 z-20 animate-fade-in">
                        <button onClick={() => { setActionMenuId(null); toast('View staff profile (demo)', 'info'); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                        <button onClick={() => { setActionMenuId(null); toast('Edit staff (demo)', 'info'); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                          <Edit className="h-3.5 w-3.5" /> Edit
                        </button>
                        {u.status === 'active' ? (
                          <button onClick={() => { setActionMenuId(null); toast(`${u.name} deactivated (demo)`, 'warning'); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-warning-600 hover:bg-warning-50 transition-colors">
                            <UserX className="h-3.5 w-3.5" /> Deactivate
                          </button>
                        ) : (
                          <button onClick={() => { setActionMenuId(null); toast(`${u.name} activated (demo)`, 'success'); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-success-600 hover:bg-success-50 transition-colors">
                            <UserCheck className="h-3.5 w-3.5" /> Activate
                          </button>
                        )}
                        <button onClick={() => { setActionMenuId(null); toast('Staff removed (demo)', 'warning'); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger-600 hover:bg-danger-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Add staff modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add New Staff Member"
        description="Create a new staff account."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => { setAddOpen(false); toast('Staff member added', 'success'); }}>Add Staff</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Full Name" name="name" placeholder="e.g. Aung Ko" />
          <Input label="Username" name="username" placeholder="e.g. aungko" />
          <Select label="Role" name="role">
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </Select>
          <Input label="Password" name="password" type="password" placeholder="••••••••" />
        </div>
      </Modal>
    </div>
  );
}
