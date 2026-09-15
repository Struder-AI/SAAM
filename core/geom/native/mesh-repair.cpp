// SPDX-License-Identifier: GPL-3.0-or-later
// SAAM adapter for unmodified CGAL 6.2.1. See README.md for dependency licenses.
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/IO/polygon_soup_io.h>
#include <CGAL/Polygon_mesh_processing/orient_polygon_soup.h>
#include <CGAL/Polygon_mesh_processing/polygon_soup_to_polygon_mesh.h>
#include <CGAL/Polygon_mesh_processing/stitch_borders.h>
#include <CGAL/Polygon_mesh_processing/triangulate_hole.h>
#include <CGAL/Polygon_mesh_processing/repair_self_intersections.h>
#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/boost/graph/border.h>
#include <CGAL/version.h>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <chrono>
#include <cmath>
namespace PMP=CGAL::Polygon_mesh_processing;
using K=CGAL::Exact_predicates_inexact_constructions_kernel;
using Mesh=CGAL::Surface_mesh<K::Point_3>;
void stage(const char* name){std::cerr<<"{\"stage\":\""<<name<<"\"}\n";}
int main(int argc,char** argv){
 try{
  if(argc==2&&std::string(argv[1])=="--version"){std::cout<<"saam-cgal-mesh-repair/1 CGAL "<<CGAL_VERSION_STR<<"\n";return 0;}
  if(argc!=5)throw std::runtime_error("Expected input.off output.off maxHoleEdges maxHoleDiameterMm");
  const auto started=std::chrono::steady_clock::now();
  const auto max_edges=std::stoul(argv[3]);const double max_diameter=std::stod(argv[4]);
  if(!std::isfinite(max_diameter)||max_diameter<0||max_edges>100000)throw std::runtime_error("Invalid hole limits");
  stage("orient");
  std::vector<K::Point_3> points;std::vector<std::vector<std::size_t>> faces;
  if(!CGAL::IO::read_polygon_soup(argv[1],points,faces))throw std::runtime_error("Cannot read repair input");
  const auto before_points=points.size(),before_faces=faces.size();
  const bool oriented=PMP::orient_polygon_soup(points,faces);
  const auto split_vertices=points.size()-before_points;
  if(!PMP::is_polygon_soup_a_polygon_mesh(faces))throw std::runtime_error("Cannot resolve polygon soup topology");
  Mesh mesh;PMP::polygon_soup_to_polygon_mesh(points,faces,mesh);
  points.clear();points.shrink_to_fit();faces.clear();faces.shrink_to_fit();
  const auto stitched=PMP::stitch_borders(mesh);
  stage("patch");
  const bool intersected=PMP::does_self_intersect(mesh);
  const bool repaired=!intersected||PMP::experimental::remove_self_intersections(mesh,CGAL::parameters::use_smoothing(false).preserve_genus(true));
  if(!repaired)throw std::runtime_error("CGAL could not repair all self-intersections; no result accepted");
  stage("boundaries");
  std::vector<Mesh::Halfedge_index> borders;CGAL::extract_boundary_cycles(mesh,std::back_inserter(borders));
  std::size_t filled=0,added=0,skipped=0;
  for(auto h:borders){
   if(!mesh.is_border(h))continue;
   std::size_t count=0;auto current=h;double lo[3]={INFINITY,INFINITY,INFINITY},hi[3]={-INFINITY,-INFINITY,-INFINITY};
   do{const auto& p=mesh.point(mesh.target(current));for(int k=0;k<3;++k){const double v=CGAL::to_double(p[k]);lo[k]=std::min(lo[k],v);hi[k]=std::max(hi[k],v);}++count;current=mesh.next(current);}while(current!=h);
   const double diameter=std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0])+(hi[1]-lo[1])*(hi[1]-lo[1])+(hi[2]-lo[2])*(hi[2]-lo[2]));
   if(max_edges==0||count>max_edges||diameter>max_diameter){++skipped;continue;}
   std::vector<Mesh::Face_index> patch;
   PMP::triangulate_hole(mesh,h,CGAL::parameters::face_output_iterator(std::back_inserter(patch)));
   if(!patch.empty()){++filled;added+=patch.size();}
  }
  stage("native-validation");
  if(!CGAL::is_closed(mesh))throw std::runtime_error("Open boundaries remain; hole filling requires explicit maxHoleEdges and maxHoleDiameterMm");
  if(PMP::does_self_intersect(mesh))throw std::runtime_error("CGAL output still intersects; no result accepted");
  mesh.collect_garbage();
  std::ofstream output(argv[2]);output<<std::setprecision(17)<<"OFF\n"<<mesh.number_of_vertices()<<' '<<mesh.number_of_faces()<<" 0\n";
  for(auto v:mesh.vertices())output<<mesh.point(v)<<'\n';
  for(auto f:mesh.faces()){auto h=mesh.halfedge(f);output<<"3 "<<mesh.target(h).idx()<<' '<<mesh.target(mesh.next(h)).idx()<<' '<<mesh.target(mesh.next(mesh.next(h))).idx()<<'\n';}
  output.close();if(!output)throw std::runtime_error("Cannot write repair output");
  std::cout<<"{\"backend\":\"CGAL "<<CGAL_VERSION_STR<<"\",\"method\":\"cgal-patch-repair/1\",\"inputTriangles\":"<<before_faces
   <<",\"orientReturned\":"<<(oriented?"true":"false")<<",\"splitVertices\":"<<split_vertices<<",\"stitchedPairs\":"<<stitched
   <<",\"selfIntersectionsRepaired\":"<<(intersected?"true":"false")<<",\"holesFilled\":"<<filled<<",\"holeTrianglesAdded\":"<<added
   <<",\"holesSkipped\":"<<skipped<<",\"outputTriangles\":"<<mesh.number_of_faces()<<",\"nativeSeconds\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()<<"}\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;
}
