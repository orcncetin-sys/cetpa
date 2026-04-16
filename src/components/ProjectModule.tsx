import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, Kanban, Calendar, Users, Plus, Search, Trash2, Edit2, Clock, Eye, X, Target, TrendingUp
} from 'lucide-react';
import { 
  DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors, useDroppable, DragEndEvent 
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, parseISO, differenceInDays, addDays, startOfMonth } from 'date-fns';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine } from 'recharts';
import ModuleHeader from './ModuleHeader';
import ConfirmModal from './ConfirmModal';
import { cn } from '../lib/utils';
import { db, auth } from '../firebase';
import { 
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, 
  doc, serverTimestamp, query, orderBy 
} from 'firebase/firestore';
import { logFirestoreError, OperationType } from '../utils/firebase';

const SortHeader: React.FC<{ label: string; sortKey: string; currentSort: { key: string; dir: 'asc' | 'desc' }; onSort: (key: string) => void; align?: 'left' | 'right' | 'center' }> = ({ label, sortKey, currentSort, onSort, align = 'left' }) => {
  const isActive = currentSort.key === sortKey;
  return (
    <th 
      className={cn(
        "py-3 px-6 text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none group hover:text-[#ff4000] transition-colors",
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className={cn("flex items-center gap-1", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
        {label}
        <div className="flex flex-col -space-y-1 opacity-40 group-hover:opacity-100 transition-opacity">
          <TrendingUp className={cn("w-2.5 h-2.5", isActive && currentSort.dir === 'asc' ? "text-[#ff4000] opacity-100" : "text-gray-400")} />
          <TrendingUp className={cn("w-2.5 h-2.5 rotate-180", isActive && currentSort.dir === 'desc' ? "text-[#ff4000] opacity-100" : "text-gray-400")} />
        </div>
      </div>
    </th>
  );
};

interface Project {
  id: string;
  name: string;
  client: string;
  manager: string;
  startDate: string;
  endDate: string;
  status: 'Active' | 'Completed' | 'On-Hold' | 'Planning';
  priority: 'High' | 'Medium' | 'Low';
  progress: number;
  budget: number;
  spent: number;
  tags: string[];
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  assignee: string;
  startDate: string;
  dueDate: string;
  status: 'Todo' | 'In-Progress' | 'Review' | 'Done';
  priority: 'High' | 'Medium' | 'Low';
}

interface Resource {
  id: string;
  name: string;
  role: string;
  activeTasks: number;
  projects: string[];
  load: number; // 0-100
}

interface ProjectModuleProps {
  currentLanguage: 'tr' | 'en';
  isAuthenticated: boolean;
  userRole?: string;
}

type ProjectData = Project | Task | Resource;

type ModalConfig = {
  isOpen: boolean;
  type: 'project' | 'task' | 'resource' | null;
  mode: 'add' | 'edit' | 'view';
  data: ProjectData | null;
};

const SortableTask: React.FC<{ task: Task; setModalConfig: React.Dispatch<React.SetStateAction<ModalConfig>>; handleDelete: (id: string, type: 'project' | 'task' | 'resource') => void; currentLanguage: 'tr' | 'en' }> = ({ task, setModalConfig, handleDelete, currentLanguage }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="apple-card p-4 space-y-3 hover:shadow-md transition-shadow group relative cursor-grab bg-white">
      <div className="flex justify-between items-start">
        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
          task.priority === 'High' ? 'bg-red-100 text-red-600' :
          task.priority === 'Medium' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
        }`}>
          {task.priority === 'High' ? (currentLanguage === 'tr' ? 'Yüksek' : 'High') :
           task.priority === 'Medium' ? (currentLanguage === 'tr' ? 'Orta' : 'Medium') :
           task.priority === 'Low' ? (currentLanguage === 'tr' ? 'Düşük' : 'Low') : task.priority}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm p-1 rounded-lg shadow-sm border border-gray-100 absolute top-2 right-2">
          <button onClick={() => setModalConfig({ isOpen: true, type: 'task', mode: 'view', data: task })} className="p-1 hover:bg-blue-50 text-blue-500 rounded-md transition-colors"><Eye className="w-3 h-3" /></button>
          <button onClick={() => setModalConfig({ isOpen: true, type: 'task', mode: 'edit', data: task })} className="p-1 hover:bg-gray-100 text-gray-500 rounded-md transition-colors"><Edit2 className="w-3 h-3" /></button>
          <button onClick={() => handleDelete(task.id, 'task')} className="p-1 hover:bg-red-50 text-red-500 rounded-md transition-colors"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
      <h4 className="font-bold text-sm text-[#1D1D1F] leading-tight pr-12">{task.title}</h4>
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#ff4000]/10 flex items-center justify-center text-[8px] font-bold text-[#ff4000]">
            {task.assignee[0]}
          </div>
          <span className="text-[10px] font-semibold text-[#86868B]">{task.assignee}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
          <Clock className="w-3 h-3" />
          {task.dueDate}
        </div>
      </div>
    </div>
  );
};

const DroppableColumn: React.FC<{ column: string; tasks: Task[]; setModalConfig: React.Dispatch<React.SetStateAction<ModalConfig>>; handleDelete: (id: string, type: 'project' | 'task' | 'resource') => void; currentLanguage: 'tr' | 'en' }> = ({ column, tasks, setModalConfig, handleDelete, currentLanguage }) => {
  const { setNodeRef } = useDroppable({ id: `col-${column}` });
  return (
    <div ref={setNodeRef} className="flex-1 min-w-[280px] bg-gray-50/50 rounded-2xl p-4 border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-sm text-[#1D1D1F]">{column}</h3>
        <span className="bg-white px-2 py-0.5 rounded-full text-[10px] font-bold text-gray-500 shadow-sm border border-gray-100">{tasks.length}</span>
      </div>
      <div className="space-y-3 min-h-[200px]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <SortableTask key={task.id} task={task} setModalConfig={setModalConfig} handleDelete={handleDelete} currentLanguage={currentLanguage} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
};

const ProjectModule: React.FC<ProjectModuleProps> = ({ currentLanguage }) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'tasks' | 'gantt' | 'resources' | 'calendar' | 'ozet'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<'All' | 'Active' | 'Completed' | 'On-Hold' | 'Planning'>('All');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('All');
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    
    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask) return;

    let newStatus: Task['status'] | null = null;

    if (typeof over.id === 'string' && over.id.startsWith('col-')) {
      newStatus = over.id.replace('col-', '') as Task['status'];
    } else {
      const overTask = tasks.find(t => t.id === over.id);
      if (overTask) newStatus = overTask.status;
    }

    if (newStatus && activeTask.status !== newStatus) {
      try {
        await updateDoc(doc(db, 'tasks', activeTask.id), { status: newStatus });
        
        // Update project progress and resource load
        const updatedTasks = tasks.map(t => t.id === activeTask.id ? { ...t, status: newStatus! } : t);
        await updateProjectProgress(activeTask.projectId, updatedTasks);
        await updateResourceLoad(activeTask.assignee, updatedTasks);
      } catch (err) {
        logFirestoreError(err, OperationType.UPDATE, `tasks/${activeTask.id}`, auth.currentUser?.uid);
      }
    }
  };
  
  // Sorting States
  const [projectSort, setProjectSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  // Sort Helper
  const sortData = <T extends Record<string, any>>(data: T[], key: string, dir: 'asc' | 'desc') => {
    return [...data].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal < bVal) return dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const toggleSort = (current: { key: string; dir: 'asc' | 'desc' }, key: string, setter: React.Dispatch<React.SetStateAction<{ key: string; dir: 'asc' | 'desc' }>>) => {
    if (current.key === key) {
      setter({ key, dir: current.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setter({ key, dir: 'asc' });
    }
  };
  
  // Modal States
  const [modalConfig, setModalConfig] = useState<ModalConfig>({
    isOpen: false,
    type: null,
    mode: 'add',
    data: null
  });
  
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const t1 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'projects'), orderBy('name')), (snap) => {
        setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'projects', auth.currentUser?.uid)));
    }, 0);
    const t2 = setTimeout(() => {
      unsubs.push(onSnapshot(collection(db, 'tasks'), (snap) => {
        setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'tasks', auth.currentUser?.uid)));
    }, 150);
    const t3 = setTimeout(() => {
      unsubs.push(onSnapshot(query(collection(db, 'resources'), orderBy('name')), (snap) => {
        setResources(snap.docs.map(d => ({ id: d.id, ...d.data() } as Resource)));
      }, (err) => logFirestoreError(err, OperationType.LIST, 'resources', auth.currentUser?.uid)));
    }, 300);
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      unsubs.forEach(u => u());
    };
  }, []);

  const saveProjects = async (newProject: Partial<Project>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'projects', modalConfig.data.id), newProject);
        showToast(currentLanguage === 'tr' ? 'Proje güncellendi' : 'Project updated');
      } else {
        await addDoc(collection(db, 'projects'), { ...newProject, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Proje oluşturuldu' : 'Project created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'projects', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const updateProjectProgress = async (projectId: string, currentTasks: Task[]) => {
    const projectTasks = currentTasks.filter(t => t.projectId === projectId);
    if (projectTasks.length === 0) return;
    
    const doneTasks = projectTasks.filter(t => t.status === 'Done').length;
    const progress = Math.round((doneTasks / projectTasks.length) * 100);
    
    try {
      await updateDoc(doc(db, 'projects', projectId), { progress });
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`, auth.currentUser?.uid);
    }
  };

  const updateResourceLoad = async (assignee: string, currentTasks: Task[]) => {
    const userTasks = currentTasks.filter(t => t.assignee === assignee && t.status !== 'Done');
    const activeTasks = userTasks.length;
    const capacity = 5; // Assume 5 tasks is 100% load
    const load = Math.min(100, Math.round((activeTasks / capacity) * 100));
    
    const resource = resources.find(r => r.name === assignee);
    if (resource) {
      try {
        await updateDoc(doc(db, 'resources', resource.id), { activeTasks, load });
      } catch (err) {
        logFirestoreError(err, OperationType.UPDATE, `resources/${resource.id}`, auth.currentUser?.uid);
      }
    }
  };

  const saveTasks = async (newTask: Partial<Task>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'tasks', modalConfig.data.id), newTask);
        showToast(currentLanguage === 'tr' ? 'Görev güncellendi' : 'Task updated');
      } else {
        await addDoc(collection(db, 'tasks'), { ...newTask, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Görev oluşturuldu' : 'Task created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'tasks', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const saveResources = async (newResource: Partial<Resource>) => {
    try {
      if (modalConfig.mode === 'edit' && modalConfig.data) {
        await updateDoc(doc(db, 'resources', modalConfig.data.id), newResource);
        showToast(currentLanguage === 'tr' ? 'Kaynak güncellendi' : 'Resource updated');
      } else {
        await addDoc(collection(db, 'resources'), { ...newResource, createdAt: serverTimestamp() });
        showToast(currentLanguage === 'tr' ? 'Kaynak oluşturuldu' : 'Resource created');
      }
    } catch (err) {
      logFirestoreError(err, modalConfig.mode === 'edit' ? OperationType.UPDATE : OperationType.CREATE, 'resources', auth.currentUser?.uid);
      showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
    }
  };

  const handleDelete = (id: string, type: 'project' | 'task' | 'resource') => {
    setConfirmModal({
      isOpen: true,
      title: currentLanguage === 'tr' ? 'Silme Onayı' : 'Delete Confirmation',
      message: currentLanguage === 'tr' ? 'Bu kaydı silmek istediğinize emin misiniz?' : 'Are you sure you want to delete this record?',
      onConfirm: async () => {
        try {
          const col = type === 'project' ? 'projects' : type === 'task' ? 'tasks' : 'resources';
          await deleteDoc(doc(db, col, id));
          showToast(currentLanguage === 'tr' ? 'Kayıt başarıyla silindi.' : 'Record deleted successfully.');
        } catch (err) {
          logFirestoreError(err, OperationType.DELETE, `${type}s/${id}`, auth.currentUser?.uid);
          showToast(currentLanguage === 'tr' ? 'Hata oluştu' : 'Error occurred', 'error');
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modalConfig.mode === 'view') {
      setModalConfig({ isOpen: false, type: null, mode: 'add', data: null });
      return;
    }

    const formData = new FormData(e.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    
    if (modalConfig.type === 'project') {
      const projectData = {
        ...data,
        progress: Number(data.progress),
        budget: Number(data.budget),
        spent: Number(data.spent),
        tags: data.tags ? (data.tags as string).split(',').map(t => t.trim()) : []
      };
      await saveProjects(projectData);
    } else if (modalConfig.type === 'task') {
      const taskData = {
        ...data,
        projectId: data.projectId as string,
      };
      await saveTasks(taskData);
    } else if (modalConfig.type === 'resource') {
      const resourceData = {
        ...data,
        activeTasks: Number(data.activeTasks),
        load: Number(data.load),
        projects: data.projects ? (data.projects as string).split(',').map(p => p.trim()) : []
      };
      await saveResources(resourceData);
    }
    
    setModalConfig({ isOpen: false, type: null, mode: 'add', data: null });
  };

  const t = {
    projects: currentLanguage === 'tr' ? 'Projeler' : 'Projects',
    tasks: currentLanguage === 'tr' ? 'Görevler' : 'Tasks',
    gantt: currentLanguage === 'tr' ? 'Takvim / Gantt' : 'Timeline / Gantt',
    resources: currentLanguage === 'tr' ? 'Kaynaklar' : 'Resources',
    calendar: currentLanguage === 'tr' ? 'Takvim' : 'Calendar',
    add: currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New',
    search: currentLanguage === 'tr' ? 'Ara...' : 'Search...',
    status: currentLanguage === 'tr' ? 'Durum' : 'Status',
    priority: currentLanguage === 'tr' ? 'Öncelik' : 'Priority',
    progress: currentLanguage === 'tr' ? 'İlerleme' : 'Progress',
    budget: currentLanguage === 'tr' ? 'Bütçe' : 'Budget',
    spent: currentLanguage === 'tr' ? 'Harcanan' : 'Spent',
    manager: currentLanguage === 'tr' ? 'Yönetici' : 'Manager',
    actions: currentLanguage === 'tr' ? 'İşlemler' : 'Actions',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <ModuleHeader
        title={currentLanguage === 'tr' ? 'Proje Yönetimi' : 'Project Management'}
        subtitle={currentLanguage === 'tr' ? 'Projeler, görevler ve kaynak planlama' : 'Projects, tasks and resource planning'}
        icon={Target}
        actionButton={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#ff4000]/20 outline-none w-full sm:w-64 transition-all"
              />
            </div>
            <button 
              onClick={() => setModalConfig({ isOpen: true, type: activeTab === 'projects' ? 'project' : activeTab === 'tasks' ? 'task' : 'resource', mode: 'add', data: null })}
              className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="w-4 h-4" /> {t.add}
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-max">
        {[
          { id: 'projects', label: t.projects, icon: LayoutDashboard },
          { id: 'tasks', label: t.tasks, icon: Kanban },
          { id: 'gantt', label: t.gantt, icon: Calendar },
          { id: 'resources', label: t.resources, icon: Users },
          { id: 'calendar', label: t.calendar, icon: Calendar },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'projects' | 'tasks' | 'gantt' | 'resources' | 'calendar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === tab.id ? 'bg-white text-[#ff4000] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'projects' && (
          <motion.div key="projects" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", projectFilter === 'Active' ? 'bg-blue-100' : 'bg-blue-50')} onClick={() => setProjectFilter('Active')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Aktif Projeler' : 'Active Projects'}</p>
                <p className="text-2xl font-bold text-blue-600">{projects.filter(p => p.status === 'Active').length}</p>
              </div>
              <div className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", projectFilter === 'Completed' ? 'bg-green-100' : 'bg-green-50')} onClick={() => setProjectFilter('Completed')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Tamamlanan' : 'Completed'}</p>
                <p className="text-2xl font-bold text-green-600">{projects.filter(p => p.status === 'Completed').length}</p>
              </div>
              <div className={cn("apple-card p-5 cursor-pointer hover:shadow-md transition-all", projectFilter === 'All' ? 'bg-orange-100' : 'bg-orange-50')} onClick={() => setProjectFilter('All')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Tüm Projeler' : 'All Projects'}</p>
                <p className="text-2xl font-bold text-orange-600">{projects.length}</p>
              </div>
              <div className="apple-card p-5 bg-purple-50 cursor-pointer hover:shadow-md transition-all" onClick={() => setProjectFilter('All')}>
                <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider mb-1">{currentLanguage === 'tr' ? 'Toplam Bütçe' : 'Total Budget'}</p>
                <p className="text-2xl font-bold text-purple-600">₺{(projects.reduce((sum, p) => sum + p.budget, 0) / 1000).toFixed(0)}K</p>
              </div>
            </div>

            {/* Project Table */}
            <div className="apple-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <SortHeader label={currentLanguage === 'tr' ? 'Proje Adı' : 'Project Name'} sortKey="name" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} />
                      <SortHeader label={currentLanguage === 'tr' ? 'Müşteri' : 'Client'} sortKey="client" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} />
                      <SortHeader label={t.manager} sortKey="manager" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} />
                      <SortHeader label={t.progress} sortKey="progress" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} align="right" />
                      <SortHeader label={t.budget} sortKey="budget" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} align="right" />
                      <SortHeader label={t.status} sortKey="status" currentSort={projectSort} onSort={(k) => toggleSort(projectSort, k, setProjectSort)} align="center" />
                      <th className="py-3 px-6 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortData(projects.filter(p => (projectFilter === 'All' || p.status === projectFilter) && p.name.toLowerCase().includes(searchQuery.toLowerCase())), projectSort.key, projectSort.dir).map(project => (
                      <tr key={project.id} className="hover:bg-gray-50 transition-colors group">
                        <td className="py-4 px-6">
                          <p className="font-bold text-[#1D1D1F]">{project.name}</p>
                          <div className="flex gap-1 mt-1">
                            {project.tags.map((tag, i) => (
                              <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">{tag}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 px-6 text-[#86868B]">{project.client}</td>
                        <td className="py-4 px-6 text-[#1D1D1F] font-medium">{project.manager}</td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-bold text-[#ff4000]">%{project.progress}</span>
                            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#ff4000]" style={{ width: `${project.progress}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-right font-bold text-[#1D1D1F]">₺{project.budget.toLocaleString()}</td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            project.status === 'Active' ? 'bg-green-100 text-green-600' :
                            project.status === 'On-Hold' ? 'bg-orange-100 text-orange-600' : 
                            project.status === 'Completed' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {project.status === 'Active' ? (currentLanguage === 'tr' ? 'Aktif' : 'Active') :
                             project.status === 'Completed' ? (currentLanguage === 'tr' ? 'Tamamlandı' : 'Completed') :
                             project.status === 'On-Hold' ? (currentLanguage === 'tr' ? 'Beklemede' : 'On-Hold') :
                             project.status === 'Planning' ? (currentLanguage === 'tr' ? 'Planlama' : 'Planning') : project.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'project', mode: 'view', data: project })} className="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'İncele' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => setModalConfig({ isOpen: true, type: 'project', mode: 'edit', data: project })} className="p-2 hover:bg-gray-200 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(project.id, 'project')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'tasks' && (
          <motion.div key="tasks" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {/* Project Filter for Tasks */}
            <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <label className="text-xs font-bold text-gray-500 uppercase">{currentLanguage === 'tr' ? 'Proje Filtrele:' : 'Filter by Project:'}</label>
              <select 
                value={selectedProjectId} 
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="apple-input py-1 text-xs"
              >
                <option value="All">{currentLanguage === 'tr' ? 'Tüm Projeler' : 'All Projects'}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {/* Kanban Board */}
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
              <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-none">
                {(['Todo', 'In-Progress', 'Review', 'Done'] as const).map(column => (
                  <DroppableColumn 
                    key={column} 
                    column={
                      column === 'Todo' ? (currentLanguage === 'tr' ? 'Yapılacak' : 'Todo') :
                      column === 'In-Progress' ? (currentLanguage === 'tr' ? 'Devam Ediyor' : 'In-Progress') :
                      column === 'Review' ? (currentLanguage === 'tr' ? 'İnceleme' : 'Review') :
                      column === 'Done' ? (currentLanguage === 'tr' ? 'Tamamlandı' : 'Done') : column
                    } 
                    tasks={tasks.filter(t => t.status === column && (selectedProjectId === 'All' || t.projectId === selectedProjectId))} 
                    setModalConfig={setModalConfig} 
                    handleDelete={handleDelete} 
                    currentLanguage={currentLanguage} 
                  />
                ))}
              </div>
            </DndContext>
          </motion.div>
        )}

        {activeTab === 'gantt' && (
          <motion.div key="gantt" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="apple-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-lg text-[#1D1D1F]">{currentLanguage === 'tr' ? 'Proje Zaman Çizelgesi' : 'Project Timeline'}</h3>
              <button 
                onClick={() => setModalConfig({ isOpen: true, type: 'project', mode: 'add', data: null })}
                className="apple-button-primary flex items-center gap-2 px-4 py-2 text-sm"
              >
                <Plus className="w-4 h-4" /> {currentLanguage === 'tr' ? 'Proje Ekle' : 'Add Project'}
              </button>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff4000]"></span>
                <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Tamamlanan' : 'Completed'}</span>
                <span className="w-3 h-3 rounded-full bg-gray-300 ml-4"></span>
                <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Planlanan' : 'Planned'}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={600}>
              <ComposedChart 
                layout="vertical" 
                data={projects.flatMap(p => {
                  const projectTasks = tasks.filter(t => t.projectId === p.id);
                  const minDate = new Date(Math.min(...projects.map(p => parseISO(p.startDate).getTime())));
                  
                  return [
                    {
                      id: p.id,
                      name: p.name,
                      type: 'project',
                      start: differenceInDays(parseISO(p.startDate), minDate),
                      duration: Math.max(1, differenceInDays(parseISO(p.endDate), parseISO(p.startDate))),
                      progress: p.progress,
                      startDate: p.startDate,
                      endDate: p.endDate
                    },
                    ...projectTasks.map(t => ({
                      id: t.id,
                      name: `  ↳ ${t.title}`,
                      type: 'task',
                      start: differenceInDays(parseISO(t.startDate), minDate),
                      duration: Math.max(1, differenceInDays(parseISO(t.dueDate), parseISO(t.startDate))),
                      progress: t.status === 'Done' ? 100 : t.status === 'In-Progress' ? 50 : 0,
                      startDate: t.startDate,
                      endDate: t.dueDate
                    }))
                  ];
                })} 
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#F5F5F7" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868B' }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 'bold', fill: '#1D1D1F' }} width={200} />
                <Tooltip content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-4 rounded-2xl shadow-xl border border-gray-100">
                        <p className="font-bold text-[#1D1D1F] mb-1">{data.name}</p>
                        <p className="text-xs text-gray-500 mb-2">{data.startDate} - {data.endDate}</p>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#ff4000]" style={{ width: `${data.progress}%` }} />
                          </div>
                          <span className="text-xs font-bold text-[#ff4000]">%{data.progress}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }} />
                <Bar dataKey="duration" fill="#E5E7EB" radius={[0, 4, 4, 0]} barSize={15} />
                <Bar dataKey={(d) => (d.duration * d.progress) / 100} fill="#ff4000" radius={[0, 4, 4, 0]} barSize={15} />
                <ReferenceLine x={differenceInDays(new Date(), new Date(Math.min(...projects.map(p => parseISO(p.startDate).getTime()))))} stroke="#3B82F6" strokeDasharray="3 3" label={{ value: currentLanguage === 'tr' ? 'Bugün' : 'Today', position: 'top', fill: '#3B82F6', fontSize: 10 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {activeTab === 'resources' && (
          <motion.div key="resources" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="apple-card p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="py-3 px-6 text-left text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İsim' : 'Name'}</th>
                  <th className="py-3 px-6 text-left text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'Rol' : 'Role'}</th>
                  <th className="py-3 px-6 text-center text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'Aktif Görevler' : 'Active Tasks'}</th>
                  <th className="py-3 px-6 text-center text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{currentLanguage === 'tr' ? 'İş Yükü' : 'Workload'}</th>
                  <th className="py-3 px-6 text-right text-[10px] text-[#86868B] font-bold uppercase tracking-wider whitespace-nowrap">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {resources.map(resource => (
                  <tr key={resource.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="py-4 px-6 font-bold text-[#1D1D1F]">{resource.name}</td>
                    <td className="py-4 px-6 text-[#86868B]">{resource.role}</td>
                    <td className="py-4 px-6 text-center text-[#1D1D1F]">{resource.activeTasks}</td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#ff4000]" style={{ width: `${resource.load}%` }} />
                        </div>
                        <span className="text-xs font-bold text-[#1D1D1F]">%{resource.load}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setModalConfig({ isOpen: true, type: 'resource', mode: 'edit', data: resource })} className="p-2 hover:bg-gray-200 text-gray-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Düzenle' : 'Edit'}><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(resource.id, 'resource')} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title={currentLanguage === 'tr' ? 'Sil' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}

        {activeTab === 'calendar' && (
          <motion.div key="calendar" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-[#1D1D1F]">{currentLanguage === 'tr' ? 'Proje Takvimi' : 'Project Calendar'}</h3>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#ff4000]" />
                    <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Projeler' : 'Projects'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'Görevler' : 'Tasks'}</span>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-7 gap-px bg-gray-100 border border-gray-100 rounded-2xl overflow-hidden shadow-inner">
                {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(day => (
                  <div key={day} className="bg-gray-50 p-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {currentLanguage === 'tr' ? day : day}
                  </div>
                ))}
                {Array.from({ length: 35 }).map((_, i) => {
                  const date = addDays(startOfMonth(new Date()), i - 2);
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const dayProjects = projects.filter(p => p.startDate === dateStr || p.endDate === dateStr);
                  const dayTasks = tasks.filter(t => t.startDate === dateStr || t.dueDate === dateStr);
                  const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;
                  
                  return (
                    <div key={i} className={cn("bg-white min-h-[120px] p-2 hover:bg-gray-50 transition-colors border-t border-l border-gray-50", isToday && "bg-orange-50/30")}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={cn("text-xs font-bold", isToday ? "text-[#ff4000]" : "text-gray-400")}>{format(date, 'd')}</span>
                        {isToday && <span className="w-1.5 h-1.5 rounded-full bg-[#ff4000]" />}
                      </div>
                      <div className="space-y-1">
                        {dayProjects.map(p => (
                          <div key={p.id} className="text-[9px] p-1.5 bg-[#ff4000]/10 text-[#ff4000] rounded-lg border border-[#ff4000]/20 truncate font-bold shadow-sm">
                            {p.name}
                          </div>
                        ))}
                        {dayTasks.map(t => (
                          <div key={t.id} className="text-[9px] p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 truncate shadow-sm">
                            {t.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODALS */}
      <AnimatePresence>
        {modalConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-[#1D1D1F]">
                  {modalConfig.mode === 'view' ? (currentLanguage === 'tr' ? 'İncele' : 'View') : modalConfig.mode === 'edit' ? (currentLanguage === 'tr' ? 'Düzenle' : 'Edit') : (currentLanguage === 'tr' ? 'Yeni Ekle' : 'Add New')}
                </h3>
                <button onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleSaveModal} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <fieldset disabled={modalConfig.mode === 'view'} className="space-y-4">
                  {modalConfig.type === 'project' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Proje Adı' : 'Project Name'}</label>
                        <input name="name" defaultValue={(modalConfig.data as Project)?.name || ''} required className="apple-input w-full" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Müşteri / Birim' : 'Client / Unit'}</label>
                          <input name="client" defaultValue={(modalConfig.data as Project)?.client || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Yönetici' : 'Manager'}</label>
                          <input name="manager" defaultValue={(modalConfig.data as Project)?.manager || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start Date'}</label>
                          <input type="date" name="startDate" defaultValue={(modalConfig.data as Project)?.startDate || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Bitiş' : 'End Date'}</label>
                          <input type="date" name="endDate" defaultValue={(modalConfig.data as Project)?.endDate || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                          <select name="status" defaultValue={(modalConfig.data as Project)?.status || 'Active'} className="apple-input w-full">
                            <option value="Active">{currentLanguage === 'tr' ? 'Aktif' : 'Active'}</option>
                            <option value="Completed">{currentLanguage === 'tr' ? 'Tamamlandı' : 'Completed'}</option>
                            <option value="On-Hold">{currentLanguage === 'tr' ? 'Beklemede' : 'On-Hold'}</option>
                            <option value="Planning">{currentLanguage === 'tr' ? 'Planlama' : 'Planning'}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Öncelik' : 'Priority'}</label>
                          <select name="priority" defaultValue={(modalConfig.data as Project)?.priority || 'Medium'} className="apple-input w-full">
                            <option value="High">{currentLanguage === 'tr' ? 'Yüksek' : 'High'}</option>
                            <option value="Medium">{currentLanguage === 'tr' ? 'Orta' : 'Medium'}</option>
                            <option value="Low">{currentLanguage === 'tr' ? 'Düşük' : 'Low'}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'İlerleme (%)' : 'Progress (%)'}</label>
                          <input type="number" name="progress" defaultValue={(modalConfig.data as Project)?.progress || 0} min="0" max="100" required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Bütçe' : 'Budget'}</label>
                          <input type="number" name="budget" defaultValue={(modalConfig.data as Project)?.budget || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Harcanan' : 'Spent'}</label>
                          <input type="number" name="spent" defaultValue={(modalConfig.data as Project)?.spent || 0} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Etiketler (Virgülle ayırın)' : 'Tags (Comma separated)'}</label>
                        <input name="tags" defaultValue={(modalConfig.data as Project)?.tags?.join(', ') || ''} className="apple-input w-full" />
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'task' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Görev Adı' : 'Task Title'}</label>
                        <input name="title" defaultValue={(modalConfig.data as Task)?.title || ''} required className="apple-input w-full" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Proje' : 'Project'}</label>
                          <select name="projectId" defaultValue={(modalConfig.data as Task)?.projectId || ''} required className="apple-input w-full">
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Sorumlu' : 'Assignee'}</label>
                          <input name="assignee" defaultValue={(modalConfig.data as Task)?.assignee || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Başlangıç' : 'Start Date'}</label>
                          <input type="date" name="startDate" defaultValue={(modalConfig.data as Task)?.startDate || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Son Tarih' : 'Due Date'}</label>
                          <input type="date" name="dueDate" defaultValue={(modalConfig.data as Task)?.dueDate || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Durum' : 'Status'}</label>
                          <select name="status" defaultValue={(modalConfig.data as Task)?.status || 'Todo'} className="apple-input w-full">
                            <option value="Todo">{currentLanguage === 'tr' ? 'Yapılacak' : 'Todo'}</option>
                            <option value="In-Progress">{currentLanguage === 'tr' ? 'Devam Ediyor' : 'In-Progress'}</option>
                            <option value="Review">{currentLanguage === 'tr' ? 'İnceleme' : 'Review'}</option>
                            <option value="Done">{currentLanguage === 'tr' ? 'Tamamlandı' : 'Done'}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Öncelik' : 'Priority'}</label>
                          <select name="priority" defaultValue={(modalConfig.data as Task)?.priority || 'Medium'} className="apple-input w-full">
                            <option value="High">{currentLanguage === 'tr' ? 'Yüksek' : 'High'}</option>
                            <option value="Medium">{currentLanguage === 'tr' ? 'Orta' : 'Medium'}</option>
                            <option value="Low">{currentLanguage === 'tr' ? 'Düşük' : 'Low'}</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  {modalConfig.type === 'resource' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'İsim' : 'Name'}</label>
                          <input name="name" defaultValue={(modalConfig.data as Resource)?.name || ''} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Rol' : 'Role'}</label>
                          <input name="role" defaultValue={(modalConfig.data as Resource)?.role || ''} required className="apple-input w-full" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Aktif Görev Sayısı' : 'Active Tasks'}</label>
                          <input type="number" name="activeTasks" defaultValue={(modalConfig.data as Resource)?.activeTasks || 0} required className="apple-input w-full" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'İş Yükü (%)' : 'Workload (%)'}</label>
                          <input type="number" name="load" defaultValue={(modalConfig.data as Resource)?.load || 0} min="0" max="100" required className="apple-input w-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{currentLanguage === 'tr' ? 'Projeler (Virgülle ayırın)' : 'Projects (Comma separated)'}</label>
                        <input name="projects" defaultValue={(modalConfig.data as Resource)?.projects?.join(', ') || ''} className="apple-input w-full" />
                      </div>
                    </>
                  )}
                </fieldset>

                <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                  <button type="button" onClick={() => setModalConfig({ isOpen: false, type: null, mode: 'add', data: null })} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                    {modalConfig.mode === 'view' ? (currentLanguage === 'tr' ? 'Kapat' : 'Close') : (currentLanguage === 'tr' ? 'İptal' : 'Cancel')}
                  </button>
                  {modalConfig.mode !== 'view' && (
                    <button type="submit" className="apple-button-primary px-8 py-2.5">
                      {currentLanguage === 'tr' ? 'Kaydet' : 'Save'}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={currentLanguage === 'tr' ? 'Sil' : 'Delete'}
        cancelText={currentLanguage === 'tr' ? 'Vazgeç' : 'Cancel'}
      />
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-2xl text-white font-medium shadow-xl z-50 transition-all ${
          toast.type === 'success' ? 'bg-[#34C759]' : toast.type === 'error' ? 'bg-[#FF3B30]' : 'bg-[#007AFF]'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default ProjectModule;
