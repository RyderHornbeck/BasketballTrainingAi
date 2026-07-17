-- New installs and existing system-theme accounts begin in light mode.
alter table public.profiles
  alter column theme set default 'light';

update public.profiles
set theme = 'light'
where theme is null or theme = 'system';
