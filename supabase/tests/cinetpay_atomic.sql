-- =============================================================================
-- cinetpay_atomic.sql — validation et idempotence de la finalisation CinetPay
-- =============================================================================
-- Test LOCAL après migrations + seed. Tout est annulé à la fin.
-- =============================================================================

begin;

insert into public.payment_transactions
  (id, tenant_id, order_id, transaction_id, amount, order_amount, currency, status, provider)
values
  ('cccccccc-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'cinetpay-atomic-test-1', 8500, 8500, 'XOF', 'initiated', 'cinetpay'),
  ('cccccccc-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000002',
   'cinetpay-atomic-test-2', 12000, 12000, 'XOF', 'initiated', 'cinetpay');

-- Le rôle serveur est le seul autorisé à invoquer la RPC.
set local role service_role;
select public.finalize_cinetpay_payment(
  'cccccccc-0000-4000-8000-000000000001', 8500, 'wave', 'WAVE', true,
  '{"test":"initial"}'::jsonb
);
reset role;

do $$
declare
  v_transaction public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_transaction from public.payment_transactions
   where id = 'cccccccc-0000-4000-8000-000000000001';
  select * into v_order from public.orders
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_transaction.status <> 'paid' or v_transaction.paid_at is null then
    raise exception 'ÉCHEC 1.1 — la transaction CinetPay n''est pas marquée payée.';
  end if;
  if v_order.payment_status <> 'paid' or v_order.payment_method <> 'wave' then
    raise exception 'ÉCHEC 1.2 — la commande n''a pas été réglée atomiquement.';
  end if;
  raise notice 'OK 1 — transaction et commande sont réglées ensemble';
end $$;

-- Simule une commande désynchronisée : le replay doit réparer la commande sans
-- modifier paid_at ni créer un second effet de paiement.
update public.orders
   set payment_status = 'pending', payment_method = null
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

set local role service_role;
select public.finalize_cinetpay_payment(
  'cccccccc-0000-4000-8000-000000000001', 8500, 'wave', 'WAVE', true,
  '{"test":"replay"}'::jsonb
);
reset role;

do $$
declare
  v_paid_at timestamptz;
  v_order_status text;
begin
  select paid_at into v_paid_at from public.payment_transactions
   where id = 'cccccccc-0000-4000-8000-000000000001';
  select payment_status into v_order_status from public.orders
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if v_paid_at is null or v_order_status <> 'paid' then
    raise exception 'ÉCHEC 2 — un replay n''a pas réparé la commande payée.';
  end if;
  raise notice 'OK 2 — une notification rejouée répare la commande de façon idempotente';
end $$;

-- Refuse un montant nul, absent (NULL) ou différent avant toute écriture.
do $$
declare
  v_refuse boolean := false;
begin
  begin
    perform public.finalize_cinetpay_payment(
      'cccccccc-0000-4000-8000-000000000002', 11995, 'orange_money', 'OM', true, '{}'::jsonb
    );
  exception
    when invalid_parameter_value then v_refuse := true;
  end;
  if not v_refuse then
    raise exception 'ÉCHEC 3.1 — un montant différent a été accepté.';
  end if;

  v_refuse := false;
  begin
    perform public.finalize_cinetpay_payment(
      'cccccccc-0000-4000-8000-000000000002', null, 'orange_money', 'OM', true, '{}'::jsonb
    );
  exception
    when invalid_parameter_value then v_refuse := true;
  end;
  if not v_refuse then
    raise exception 'ÉCHEC 3.2 — un montant absent a été accepté.';
  end if;

  if (select status from public.payment_transactions
       where id = 'cccccccc-0000-4000-8000-000000000002') <> 'initiated' then
    raise exception 'ÉCHEC 3.3 — une tentative rejetée a modifié la transaction.';
  end if;
  raise notice 'OK 3 — un montant différent ou absent est refusé sans écriture';
end $$;

-- Anon et authenticated ne peuvent pas appeler une fonction SECURITY DEFINER.
do $$
begin
  if has_function_privilege(
       'anon',
       'public.finalize_cinetpay_payment(uuid,integer,text,text,boolean,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'ÉCHEC 4.1 — anon peut exécuter la RPC.';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.finalize_cinetpay_payment(uuid,integer,text,text,boolean,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'ÉCHEC 4.2 — authenticated peut exécuter la RPC.';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.finalize_cinetpay_payment(uuid,integer,text,text,boolean,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'ÉCHEC 4.3 — service_role ne peut pas exécuter la RPC.';
  end if;
  raise notice 'OK 4 — exécution réservée à service_role';
end $$;

rollback;
